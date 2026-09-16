import { assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import type { Env } from '../_shared/env.ts'
import type { AanvraagRow, BijlageRow, Db, NewAanvraag } from '../_shared/db.ts'
import { HUISSTIJL_MARKER, renderNotes } from '../_shared/notes.ts'
import { subtaskTitles, taskTitle } from '../_shared/shared/asana-title.ts'
import { buildCustomFields } from '../_shared/asana.ts'
import type { TaskInput } from '../_shared/asana.ts'
import { createHandler, type Deps } from './handler.ts'

const env: Env = {
  supabaseUrl: 'http://sb',
  supabaseSecretKey: 'x',
  allowedOrigins: ['https://marketing-nbc.github.io'],
  rateSalt: 'salt',
  rateLimitIpPerHour: 3,
  rateLimitGlobalPerDay: 5,
  asanaPat: 'pat',
  asanaProjectGid: '111',
  asanaAssigneeGid: '222',
  asanaPlanningProjectGid: null,
  routineFireUrl: 'https://routine',
  routineToken: 'tok',
}

function fakeDb() {
  const rows = new Map<string, AanvraagRow & NewAanvraag>()
  const counters = new Map<string, number>()
  const db: Db & { rows: typeof rows; counters: typeof counters } = {
    rows,
    counters,
    async findByClientRequestId(id) {
      for (const r of rows.values()) if (r.client_request_id === id) return r
      return null
    },
    async insert(row) {
      const full = { ...row, id: crypto.randomUUID(), asana_task_gid: null, asana_task_url: null, asana_error: null, brand_status: 'pending' as const, brand_error: null, brand_session_url: null, vervallen_op: null }
      rows.set(full.id, full)
      return full
    },
    async update(id, patch) {
      const r = rows.get(id)
      if (!r) throw new Error('rij niet gevonden')
      rows.set(id, { ...r, ...patch })
    },
    async bumpRateLimit(key) {
      const n = (counters.get(key) ?? 0) + 1
      counters.set(key, n)
      return n
    },
    async isCollega(naam) {
      return naam !== 'Onbekende Indringer'
    },
    // Alleen de aanvulling-function gebruikt deze; hier zijn ze er om aan `Db` te voldoen.
    findById: () => Promise.resolve(null),
    zoekOpEvent: () => Promise.resolve([]),
    markeerVervallen: () => Promise.resolve(false),
    findAanvullingByClientRequestId: () => Promise.resolve(null),
    insertAanvulling: () => Promise.reject(new Error('niet gebruikt')),
    updateAanvulling: () => Promise.resolve(),
    insertBijlagen: () => Promise.resolve(),
    claimBijlagen: () => Promise.resolve([]),
    openBijlagenVan: () => Promise.resolve([]),
    markeerBijlage: () => Promise.resolve(),
  }
  return db
}

function fakeAsana(opts: { fail?: boolean; warnings?: string[]; optieFail?: boolean } = {}) {
  const calls: TaskInput[] = []
  const opties: { fieldGid: string; naam: string }[] = []
  return {
    calls,
    opties,
    async enumOptie(fieldGid: string, naam: string) {
      if (opts.optieFail) throw new Error('403: Not Authorized')
      opties.push({ fieldGid, naam })
      return `optie-${naam}`
    },
    async createTask(input: TaskInput) {
      calls.push(input)
      if (opts.fail) throw new Error('Asana-taak aanmaken mislukt (401: Not Authorized)')
      return { gid: '999', url: 'https://app.asana.com/0/111/999', subtasks: input.subtasks.length, warnings: opts.warnings ?? [] }
    },
    uploadAttachment: () => Promise.resolve({ gid: 'att-1', url: null }),
  }
}

function fakeRoutine(opts: { fail?: boolean } = {}) {
  const texts: string[] = []
  return {
    texts,
    async fire(text: string) {
      texts.push(text)
      if (opts.fail) throw new Error('Routine starten mislukt (429: daily cap)')
      return { sessionUrl: 'https://claude.ai/code/session_x' }
    },
  }
}

const validAanvraag = {
  naam: 'Noa',
  event: 'Zorgcongres 2026',
  event_datum: '2026-11-20',
  deadline: '2026-11-10',
  website: 'www.zorgcongres.nl',
  schijf_locatie: 'G:\\Events\\2026\\Zorgcongres',
  aanvraag_types: ['led_kolom', 'vlaggen', 'anders'],
  anders_tekst: 'Roll-up',
  design_modus: 'custom',
  omschrijving: 'Graag <groot> & duidelijk.',
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    aanvraag: validAanvraag,
    client_request_id: crypto.randomUUID(),
    started_at: new Date(Date.now() - 60_000).toISOString(),
    website_confirm: '',
    ...overrides,
  }
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://f/submit-aanvraag', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://marketing-nbc.github.io', 'x-forwarded-for': '1.2.3.4', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function setup(over: Partial<Deps> = {}) {
  const db = fakeDb()
  const asana = fakeAsana()
  const routine = fakeRoutine()
  const handler = createHandler({ env, db, asana, routine, storage: null, log: () => {}, ...over })
  return { db, asana, routine, handler }
}

Deno.test('OPTIONS geeft CORS-headers', async () => {
  const { handler } = setup()
  const res = await handler(new Request('http://f', { method: 'OPTIONS', headers: { origin: 'https://marketing-nbc.github.io' } }))
  assertEquals(res.status, 204)
  assertEquals(res.headers.get('access-control-allow-origin'), 'https://marketing-nbc.github.io')
})

Deno.test('onbekende origin krijgt de eerste toegestane origin terug', async () => {
  const { handler } = setup()
  const res = await handler(new Request('http://f', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }))
  assertEquals(res.headers.get('access-control-allow-origin'), 'https://marketing-nbc.github.io')
})

Deno.test('ongeldige JSON → 400', async () => {
  const { handler } = setup()
  const res = await handler(post('{nope'))
  assertEquals(res.status, 400)
})

Deno.test('honeypot gevuld → 200 zonder opslag', async () => {
  const { handler, db, asana } = setup()
  const res = await handler(post(payload({ website_confirm: 'spam' })))
  assertEquals(res.status, 200)
  assertEquals(db.rows.size, 0)
  assertEquals(asana.calls.length, 0)
})

Deno.test('te snel ingevuld → 200 zonder opslag', async () => {
  const { handler, db } = setup()
  const res = await handler(post(payload({ started_at: new Date().toISOString() })))
  assertEquals(res.status, 200)
  assertEquals(db.rows.size, 0)
})

Deno.test('validatiefout → 400 met veld', async () => {
  const { handler } = setup()
  const res = await handler(post(payload({ aanvraag: { ...validAanvraag, deadline: '2026-12-01' } })))
  assertEquals(res.status, 400)
  const body = await res.json()
  assertEquals(body.field, 'aanvraag.deadline')
})

Deno.test('gelukte aanvraag: rij, Asana-taak en Routine', async () => {
  const { handler, db, asana, routine } = setup()
  const res = await handler(post(payload()))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.asana_task_url, 'https://app.asana.com/0/111/999')
  assertEquals(body.brand_dispatched, true)
  assertEquals(db.rows.size, 1)
  const row = [...db.rows.values()][0]
  assertEquals(row.asana_task_gid, '999')
  assertEquals(row.brand_status, 'running')
  assertEquals(row.brand_session_url, 'https://claude.ai/code/session_x')
  assertEquals(row.website, 'https://www.zorgcongres.nl/')
  assertEquals(routine.texts, [`aanvraag_id=${row.id}`])
  assertEquals(asana.calls[0].name, 'Meerdere designs Zorgcongres 2026 - 20 november 2026 - Noa')
  assertEquals(asana.calls[0].subtasks, ['LED-kolom Zorgcongres 2026', 'Vlaggen Zorgcongres 2026', 'Roll-up Zorgcongres 2026'])
  assertEquals(asana.calls[0].assigneeGid, '222')
  assertMatch(asana.calls[0].htmlNotes, /^<body>.*<\/body>$/s)
  assertMatch(asana.calls[0].htmlNotes, /&lt;groot&gt; &amp; duidelijk/)
  assertMatch(asana.calls[0].htmlNotes, new RegExp(HUISSTIJL_MARKER))
})

Deno.test('zelfde client_request_id → zelfde antwoord, geen tweede taak', async () => {
  const { handler, db, asana } = setup()
  const p = payload()
  const a = await (await handler(post(p))).json()
  const b = await (await handler(post(p))).json()
  assertEquals(a.aanvraag_id, b.aanvraag_id)
  assertEquals(db.rows.size, 1)
  assertEquals(asana.calls.length, 1)
})

Deno.test('rate limit per IP', async () => {
  const { handler } = setup()
  for (let i = 0; i < 3; i++) assertEquals((await handler(post(payload()))).status, 200)
  assertEquals((await handler(post(payload()))).status, 429)
  // Ander IP mag nog wel.
  assertEquals((await handler(post(payload(), { 'x-forwarded-for': '9.9.9.9' }))).status, 200)
})

Deno.test('globaal dagplafond', async () => {
  const { handler } = setup()
  let last = 0
  for (let i = 0; i < 6; i++) last = (await handler(post(payload(), { 'x-forwarded-for': `10.0.0.${i}` }))).status
  assertEquals(last, 429)
})

Deno.test('Asana mislukt → aanvraag bewaard, brand failed, 200', async () => {
  const { handler, db } = setup({ asana: fakeAsana({ fail: true }) })
  const res = await handler(post(payload()))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.asana_task_url, null)
  assertEquals(body.brand_dispatched, false)
  const row = [...db.rows.values()][0]
  assertMatch(row.asana_error ?? '', /Not Authorized/)
  assertEquals(row.brand_status, 'failed')
})

Deno.test('Routine mislukt → taak bestaat, brand failed', async () => {
  const { handler, db } = setup({ routine: fakeRoutine({ fail: true }) })
  const body = await (await handler(post(payload()))).json()
  assertEquals(body.brand_dispatched, false)
  assertMatch(body.asana_task_url, /asana/)
  const row = [...db.rows.values()][0]
  assertEquals(row.brand_status, 'failed')
  assertMatch(row.brand_error ?? '', /daily cap/)
})

Deno.test('zonder Asana-configuratie → aanvraag bewaard, geen taak', async () => {
  const { handler, db } = setup({ asana: null, env: { ...env, asanaProjectGid: null } })
  const body = await (await handler(post(payload()))).json()
  assertEquals(body.asana_task_url, null)
  assertEquals(db.rows.size, 1)
})

Deno.test('taskTitle, subtaskTitles en notes', () => {
  const a = { ...validAanvraag, website: 'https://www.zorgcongres.nl/', aanvraag_types: ['menu_scherm'] as const, anders_tekst: '' }
  // deno-lint-ignore no-explicit-any
  assertEquals(taskTitle(a as any), 'Menu scherm Zorgcongres 2026 - 20 november 2026 - Noa')
  // deno-lint-ignore no-explicit-any
  assertEquals(subtaskTitles(a as any), [])
  // Eén type "anders" → de vrije tekst als wat.
  // deno-lint-ignore no-explicit-any
  assertEquals(taskTitle({ ...a, aanvraag_types: ['anders'], anders_tekst: 'Roll-up banner' } as any), 'Roll-up banner Zorgcongres 2026 - 20 november 2026 - Noa')
  // deno-lint-ignore no-explicit-any
  const notes = renderNotes(a as any, { aanvraagId: 'abc' })
  assertMatch(notes.html, /<strong>Eventdatum:<\/strong> vrijdag 20 november 2026/)
  assertMatch(notes.html, /<a href="https:\/\/www.zorgcongres.nl\/">zorgcongres.nl<\/a>/)
  assertMatch(notes.plain, /Eventdatum: vrijdag 20 november 2026/)
})

Deno.test('buildCustomFields gebruikt alleen gemapte velden', () => {
  const cfg = {
    project: { gid: '1' },
    assignee: null,
    fields: {
      eventdatum: { gid: 'f1', name: 'Eventdatum', type: 'date' },
      deadline: { gid: 'f2', name: 'Deadline', type: 'date' },
      type: { gid: 'f3', name: 'Type', type: 'multi_enum', options: { led_kolom: 'o1', vlaggen: 'o2' } },
      modus: { gid: 'f4', name: 'Design', type: 'enum', options: { custom: 'o3', standaard: 'o4' } },
      aanvrager: { gid: 'f5', name: 'Aanvrager', type: 'enum', options: { Wendy: 'o5' } },
      website: { gid: 'f6', name: 'Website', type: 'text' },
    },
  }
  // deno-lint-ignore no-explicit-any
  const out = buildCustomFields({ ...validAanvraag, website: 'https://x.nl/' } as any, cfg)
  assertEquals(out, { f1: { date: '2026-11-20' }, f2: { date: '2026-11-10' }, f3: ['o1', 'o2'], f4: 'o3', f6: 'https://x.nl/' })
})

Deno.test('taak zonder waarschuwingen laat asana_error leeg', async () => {
  const { handler, db } = setup()
  await handler(post(payload()))
  assertEquals([...db.rows.values()][0].asana_error, null)
})

Deno.test('gedeeltelijk gelukte taak: aanvraag slaagt, reden in asana_error', async () => {
  const db = fakeDb()
  const asana = fakeAsana({ warnings: ['velden niet gezet: deadline (400: Invalid field)'] })
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage: null, log: () => {} })
  const res = await handler(post(payload()))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.asana_task_url, 'https://app.asana.com/0/111/999')
  const row = [...db.rows.values()][0]
  assertEquals(row.asana_error, 'velden niet gezet: deadline (400: Invalid field)')
  // De huisstijl-extractie hoort gewoon te starten; de taak bestaat immers.
  assertEquals(row.brand_status, 'running')
})

Deno.test('buildCustomFields zet het spoedveld op de juiste optie', () => {
  const cfg = {
    project: { gid: '1' },
    assignee: null,
    fields: { spoed: { gid: 'f9', name: 'Spoed', type: 'enum', options: { ja: 'oJa', nee: 'oNee' } } },
  }
  // deno-lint-ignore no-explicit-any
  const a = validAanvraag as any
  assertEquals(buildCustomFields(a, cfg, { spoed: true }), { f9: 'oJa' })
  assertEquals(buildCustomFields(a, cfg, { spoed: false }), { f9: 'oNee' })
  // Zonder uitspraak over spoed blijft het veld leeg in plaats van dat we "nee" gokken.
  assertEquals(buildCustomFields(a, cfg), {})
})

Deno.test('spoed wordt bij het indienen bepaald en opgeslagen', async () => {
  // Maandag 14 september 2026; het event is op 20 november, dus ruim op tijd.
  const rustig = setup({ now: () => new Date('2026-09-14T10:00:00Z') })
  await rustig.handler(post(payload({ started_at: '2026-09-14T09:59:00Z' })))
  const rij = [...rustig.db.rows.values()][0]
  assertEquals(rij.spoed, false)
  assertEquals(rij.werkdagen_tot_event, 49)

  // Zelfde aanvraag, maar ingediend acht werkdagen voor het event.
  const krap = setup({ now: () => new Date('2026-11-10T10:00:00Z') })
  await krap.handler(post(payload({ started_at: '2026-11-10T09:59:00Z' })))
  const spoedRij = [...krap.db.rows.values()][0]
  assertEquals(spoedRij.spoed, true)
  assertEquals(spoedRij.werkdagen_tot_event, 8)
})

/** Veldmapping zoals na de workflow: Aanvrager is een keuzelijst zonder opties in de repo. */
const velden = {
  project: { gid: '111' },
  assignee: { gid: '222' },
  fields: { aanvrager: { gid: 'fA', name: 'Aanvrager', type: 'enum' } },
  sections: {},
} as unknown as Parameters<typeof createHandler>[0]['fields']

Deno.test('aanvrager-optie wordt opgezocht en op de taak gezet', async () => {
  const db = fakeDb()
  const asana = fakeAsana()
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage: null, fields: velden, log: () => {} })
  await handler(post(payload()))
  assertEquals(asana.opties, [{ fieldGid: 'fA', naam: 'Noa' }])
  assertEquals(asana.calls[0].customFields, { fA: 'optie-Noa' })
  assertEquals([...db.rows.values()][0].asana_error, null)
})

Deno.test('naam buiten de collegalijst krijgt geen optie', async () => {
  const db = fakeDb()
  const asana = fakeAsana()
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage: null, fields: velden, log: () => {} })
  await handler(post(payload({ aanvraag: { ...validAanvraag, naam: 'Onbekende Indringer' } })))
  // Geen nieuwe optie in Asana, veld leeg, en de reden staat in de rij.
  assertEquals(asana.opties, [])
  assertEquals(asana.calls[0].customFields, {})
  assertMatch([...db.rows.values()][0].asana_error ?? '', /staat niet in de lijst met collega's/)
})

Deno.test('mislukte optie-lookup blokkeert de aanvraag niet', async () => {
  const db = fakeDb()
  const asana = fakeAsana({ optieFail: true })
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage: null, fields: velden, log: () => {} })
  const res = await handler(post(payload()))
  assertEquals(res.status, 200)
  const rij = [...db.rows.values()][0]
  assertEquals(rij.asana_task_gid, '999')
  assertMatch(rij.asana_error ?? '', /veld Aanvrager niet gezet: 403/)
})

Deno.test('zonder website: taak wel, huisstijl overgeslagen', async () => {
  const { handler, db, asana, routine } = setup()
  const res = await handler(post(payload({ aanvraag: { ...validAanvraag, website: '' } })))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.asana_task_url, 'https://app.asana.com/0/111/999')
  assertEquals(body.brand_dispatched, false)
  // De Routine wordt niet gestart: er valt niets op te halen.
  assertEquals(routine.texts, [])
  const rij = [...db.rows.values()][0]
  assertEquals(rij.brand_status, 'overgeslagen')
  assertEquals(rij.brand_error, null)
  // De beschrijving vermeldt het, en het Website-veld blijft leeg.
  assertMatch(asana.calls[0].plainNotes, /Website: niet opgegeven/)
  assertMatch(asana.calls[0].htmlNotes, /geen website op/)
})

// ── Meegestuurde bestanden ───────────────────────────────────────────────────

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
// Echte uuid's: het schema weigert al iets anders, en dat hoort het ook te doen.
const B1 = '11111111-1111-4111-8111-111111111111'
const B2 = '22222222-2222-4222-8222-222222222222'
const PDF = new TextEncoder().encode('%PDF-1.4\nrest van het bestand')

function bijlageRij(over: Partial<BijlageRow> = {}): BijlageRow {
  return {
    id: B1,
    groep_id: 'g-1',
    bestandsnaam: 'logo.png',
    mime: 'image/png',
    bytes: PNG.length,
    storage_path: 'g-1/b-1.png',
    status: 'verwacht',
    asana_gid: null,
    ...over,
  }
}

/** Db-fake met bijlagen erbij: onthoudt wat er geclaimd en gemarkeerd wordt. */
function dbMetBijlagen(rijen: BijlageRow[]) {
  const db = fakeDb()
  const gemarkeerd: { id: string; patch: Record<string, unknown> }[] = []
  let open = [...rijen]
  return Object.assign(db, {
    gemarkeerd,
    claimBijlagen: (ids: string[]) => Promise.resolve(rijen.filter((r) => ids.includes(r.id))),
    openBijlagenVan: () => Promise.resolve(open),
    markeerBijlage: (id: string, patch: Record<string, unknown>) => {
      gemarkeerd.push({ id, patch })
      if (patch.status !== 'verwacht') open = open.filter((r) => r.id !== id)
      return Promise.resolve()
    },
  })
}

function fakeStorage(bestanden: Record<string, { bytes: Uint8Array; mime: string }>) {
  return {
    uploadlink: () => Promise.resolve('https://sb/x'),
    download: (pad: string) => Promise.resolve(bestanden[pad] ? { bytes: new Uint8Array(bestanden[pad].bytes), mime: bestanden[pad].mime } : null),
  }
}

function asanaMetBijlagen(opts: { weigert?: string[] } = {}) {
  const asana = fakeAsana()
  const geplaatst: { naam: string; bytes: number }[] = []
  return Object.assign(asana, {
    geplaatst,
    uploadAttachment: (_gid: string, naam: string, bytes: Uint8Array) => {
      if (opts.weigert?.includes(naam)) return Promise.reject(new Error('Bijlage mislukt (413: te groot voor Asana)'))
      geplaatst.push({ naam, bytes: bytes.length })
      return Promise.resolve({ gid: `att-${geplaatst.length}`, url: null })
    },
  })
}

Deno.test('bijlagen komen bij de taak en staan in de beschrijving', async () => {
  const rijen = [bijlageRij(), bijlageRij({ id: B2, bestandsnaam: 'brief.pdf', mime: 'application/pdf', storage_path: 'g-1/b-2.pdf', bytes: PDF.length })]
  const db = dbMetBijlagen(rijen)
  const asana = asanaMetBijlagen()
  const storage = fakeStorage({ 'g-1/b-1.png': { bytes: PNG, mime: 'image/png' }, 'g-1/b-2.pdf': { bytes: PDF, mime: 'application/pdf' } })
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage, log: () => {} })

  const res = await handler(post(payload({ bijlage_ids: [B1, B2] })))
  assertEquals(res.status, 200)

  assertEquals(asana.geplaatst.map((g) => g.naam), ['logo.png', 'brief.pdf'])
  assertEquals(db.gemarkeerd.every((m) => m.patch.status === 'gekoppeld'), true)
  // De namen staan in de taakbeschrijving, ook als een bijlage later zou mislukken.
  assertStringIncludes(asana.calls[0].htmlNotes, 'logo.png, brief.pdf')
  const rij = [...db.rows.values()][0]
  assertEquals(rij.asana_error, null)
})

Deno.test('een bijlage die Asana weigert laat de aanvraag staan', async () => {
  const db = dbMetBijlagen([bijlageRij()])
  const asana = asanaMetBijlagen({ weigert: ['logo.png'] })
  const storage = fakeStorage({ 'g-1/b-1.png': { bytes: PNG, mime: 'image/png' } })
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage, log: () => {} })

  const res = await handler(post(payload({ bijlage_ids: [B1] })))
  assertEquals(res.status, 200)
  const rij = [...db.rows.values()][0]
  assertMatch(rij.asana_error ?? '', /logo\.png/)
  assertEquals(db.gemarkeerd[0].patch.status, 'mislukt')
})

Deno.test('bytes die niet bij het opgegeven type horen worden geweigerd', async () => {
  // Beweert een PDF te zijn, maar het zijn PNG-bytes. De bucket kijkt daar niet naar.
  const db = dbMetBijlagen([bijlageRij({ mime: 'application/pdf', bestandsnaam: 'nep.pdf', storage_path: 'g-1/b-1.pdf' })])
  const asana = asanaMetBijlagen()
  const storage = fakeStorage({ 'g-1/b-1.pdf': { bytes: PNG, mime: 'application/pdf' } })
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage, log: () => {} })

  await handler(post(payload({ bijlage_ids: [B1] })))
  assertEquals(asana.geplaatst.length, 0)
  assertEquals(db.gemarkeerd[0].patch.status, 'geweigerd')
  assertMatch([...db.rows.values()][0].asana_error ?? '', /is geen application\/pdf/)
})

Deno.test('een bestand dat uit de opslag verdwenen is blokkeert niets', async () => {
  const db = dbMetBijlagen([bijlageRij()])
  const asana = asanaMetBijlagen()
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage: fakeStorage({}), log: () => {} })

  const res = await handler(post(payload({ bijlage_ids: [B1] })))
  assertEquals(res.status, 200)
  assertMatch([...db.rows.values()][0].asana_error ?? '', /stond niet meer in de opslag/)
})

Deno.test('een id dat al ergens bij hoort wordt gemeld en overgeslagen', async () => {
  const db = dbMetBijlagen([]) // claim geeft niets terug
  const asana = asanaMetBijlagen()
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage: fakeStorage({}), log: () => {} })

  const res = await handler(post(payload({ bijlage_ids: [B1, B2] })))
  assertEquals(res.status, 200)
  assertEquals(asana.geplaatst.length, 0)
  assertMatch([...db.rows.values()][0].asana_error ?? '', /2 meegestuurd bestand\(en\) niet gevonden/)
})

Deno.test('een herhaalde verzending pakt blijven liggen bijlagen alsnog op', async () => {
  const db = dbMetBijlagen([bijlageRij()])
  const asana = asanaMetBijlagen()
  const storage = fakeStorage({ 'g-1/b-1.png': { bytes: PNG, mime: 'image/png' } })
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), storage, log: () => {} })

  // Eerste poging: doe alsof de aanvraag al bestond maar de bijlage nog niet geplaatst was.
  const p = payload({ bijlage_ids: [] })
  await handler(post(p))
  assertEquals(asana.geplaatst.length, 0)

  // Zelfde client_request_id: de aanvraag komt er niet nog een keer, de bijlage wél.
  const res = await handler(post(p))
  assertEquals(res.status, 200)
  assertEquals(db.rows.size, 1)
  assertEquals(asana.geplaatst.map((g) => g.naam), ['logo.png'])
})

Deno.test('zonder bijlagen verandert er niets aan de taakbeschrijving', async () => {
  const { handler, asana } = setup()
  await handler(post(payload()))
  assertEquals(asana.calls[0].htmlNotes.includes('Meegestuurd'), false)
})
