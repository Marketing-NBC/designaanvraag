import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import type { Env } from '../_shared/env.ts'
import type { AanvraagRow, Db, NewAanvraag } from '../_shared/db.ts'
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
      const full = { ...row, id: crypto.randomUUID(), asana_task_gid: null, asana_task_url: null, asana_error: null, brand_status: 'pending' as const, brand_error: null, brand_session_url: null }
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
  const handler = createHandler({ env, db, asana, routine, log: () => {}, ...over })
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
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), log: () => {} })
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
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), fields: velden, log: () => {} })
  await handler(post(payload()))
  assertEquals(asana.opties, [{ fieldGid: 'fA', naam: 'Noa' }])
  assertEquals(asana.calls[0].customFields, { fA: 'optie-Noa' })
  assertEquals([...db.rows.values()][0].asana_error, null)
})

Deno.test('naam buiten de collegalijst krijgt geen optie', async () => {
  const db = fakeDb()
  const asana = fakeAsana()
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), fields: velden, log: () => {} })
  await handler(post(payload({ aanvraag: { ...validAanvraag, naam: 'Onbekende Indringer' } })))
  // Geen nieuwe optie in Asana, veld leeg, en de reden staat in de rij.
  assertEquals(asana.opties, [])
  assertEquals(asana.calls[0].customFields, {})
  assertMatch([...db.rows.values()][0].asana_error ?? '', /staat niet in de lijst met collega's/)
})

Deno.test('mislukte optie-lookup blokkeert de aanvraag niet', async () => {
  const db = fakeDb()
  const asana = fakeAsana({ optieFail: true })
  const handler = createHandler({ env, db, asana, routine: fakeRoutine(), fields: velden, log: () => {} })
  const res = await handler(post(payload()))
  assertEquals(res.status, 200)
  const rij = [...db.rows.values()][0]
  assertEquals(rij.asana_task_gid, '999')
  assertMatch(rij.asana_error ?? '', /veld Aanvrager niet gezet: 403/)
})
