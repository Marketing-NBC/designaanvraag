import { assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import type { AsanaFieldsConfig, AsanaTask } from '../_shared/asana.ts'
import type { AanvraagDetail, AanvullingRow, Db, NewAanvulling } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import type { AanvullingInput } from '../_shared/shared/aanvulling-schema.ts'
import { bepaalWijziging, createHandler, type Deps } from './handler.ts'

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
  routineFireUrl: null,
  routineToken: null,
}

/** Eigen mapping met herkenbare gids, zodat een assertie leest als de bedoeling. */
const cfg: AsanaFieldsConfig = {
  project: { gid: '111' },
  assignee: { gid: '222' },
  sections: {
    nieuwe_aanvragen: { gid: 'sec-nieuw', name: 'Nieuwe aanvragen' },
    feedback: { gid: 'sec-feedback', name: 'Feedback' },
    mee_bezig: { gid: 'sec-bezig', name: 'Mee bezig' },
    klaar: { gid: 'sec-klaar', name: 'Klaar' },
  },
  fields: {
    eventdatum: { gid: 'f-event', name: 'Eventdatum', type: 'date' },
    deadline: { gid: 'f-deadline', name: 'Deadline', type: 'date' },
    schijf: { gid: 'f-schijf', name: 'Schijf', type: 'text' },
    type: {
      gid: 'f-type',
      name: 'Type aanvraag',
      type: 'multi_enum',
      options: { led_kolom: 'o-led', vlaggen: 'o-vlag', menukaart_print: 'o-menu', anders: 'o-anders' },
    },
  },
}

const AANVRAAG_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function aanvraag(over: Partial<AanvraagDetail> = {}): AanvraagDetail {
  return {
    id: AANVRAAG_ID,
    client_request_id: '11111111-1111-4111-8111-111111111111',
    asana_task_gid: '999',
    asana_task_url: 'https://app.asana.com/0/111/999',
    asana_error: null,
    spoed: false,
    werkdagen_tot_event: 30,
    brand_status: 'done',
    brand_error: null,
    brand_session_url: null,
    vervallen_op: null,
    event: 'Zorgcongres 2026',
    event_datum: '2026-12-01',
    deadline: '2026-11-20',
    aanvraag_types: ['led_kolom'],
    anders_tekst: '',
    schijf_locatie: '',
    ...over,
  }
}

function fakeDb(row: AanvraagDetail | null = aanvraag()) {
  const aanvullingen: (AanvullingRow & NewAanvulling)[] = []
  const patches: Record<string, unknown>[] = []
  const counters = new Map<string, number>()
  const db: Db & { aanvullingen: typeof aanvullingen; patches: typeof patches; counters: typeof counters } = {
    aanvullingen,
    patches,
    counters,
    findByClientRequestId: () => Promise.resolve(null),
    insert: () => Promise.reject(new Error('niet gebruikt')),
    async update(_id, patch) {
      patches.push(patch)
    },
    async bumpRateLimit(key) {
      const n = (counters.get(key) ?? 0) + 1
      counters.set(key, n)
      return n
    },
    isCollega: () => Promise.resolve(true),
    findById: (id) => Promise.resolve(row && row.id === id ? row : null),
    zoekOpEvent: () => Promise.resolve([]),
    markeerVervallen: () => Promise.resolve(false),
    async findAanvullingByClientRequestId(id) {
      return aanvullingen.find((a) => a.client_request_id === id) ?? null
    },
    async insertAanvulling(r) {
      const full = { ...r, id: `aanv-${aanvullingen.length + 1}`, bijgewerkt: [], asana_error: null }
      aanvullingen.push(full)
      return full
    },
    async updateAanvulling(id, patch) {
      const i = aanvullingen.findIndex((a) => a.id === id)
      if (i >= 0) aanvullingen[i] = { ...aanvullingen[i], ...patch } as (typeof aanvullingen)[number]
    },
    insertBijlagen: () => Promise.resolve(),
    claimBijlagen: () => Promise.resolve([]),
    openBijlagenVan: () => Promise.resolve([]),
    markeerBijlage: () => Promise.resolve(),
  }
  return db
}

function fakeAsana(taak: Partial<AsanaTask> = {}, opts: { commentFail?: boolean; veldWaarschuwing?: string[]; verplaatsFail?: boolean } = {}) {
  const velden: Record<string, unknown>[] = []
  const comments: string[] = []
  const verplaatst: string[] = []
  let heropend = 0
  return {
    velden,
    comments,
    verplaatst,
    get heropend() {
      return heropend
    },
    getTask: (gid: string) =>
      Promise.resolve<AsanaTask>({
        gid,
        name: 'Zorgcongres 2026',
        dueOn: null,
        completed: false,
        assignee: '222',
        projects: ['111'],
        memberships: [{ project: '111', section: 'sec-bezig' }],
        customFields: { 'f-type': { optieGids: ['o-led'], datum: null, tekst: null } },
        ...taak,
      }),
    addToProject: () => Promise.resolve(),
    listComments: () => Promise.resolve(comments),
    async addComment(_gid: string, html: string) {
      if (opts.commentFail) throw new Error('Comment plaatsen mislukt (403: Not Authorized)')
      comments.push(html)
    },
    async updateCustomFields(_gid: string, fields: Record<string, unknown>) {
      velden.push(fields)
      return opts.veldWaarschuwing ?? []
    },
    uploadAttachment: () => Promise.resolve({ gid: 'att-1', url: null }),
    moveToSection: (_gid: string, sectionGid: string) => {
      if (opts.verplaatsFail) return Promise.reject(new Error('Taak verplaatsen mislukt (403: Not Authorized)'))
      verplaatst.push(sectionGid)
      return Promise.resolve()
    },
    heropen: () => {
      heropend++
      return Promise.resolve()
    },
  }
}

function payload(over: Partial<AanvullingInput> = {}) {
  return {
    aanvulling: {
      aanvraag_id: AANVRAAG_ID,
      naam: 'Wendy Tester',
      toelichting: 'We willen er ook vlaggen bij.',
      ...over,
    },
    client_request_id: crypto.randomUUID(),
    // Ruim voorbij de minimale invultijd.
    started_at: new Date(Date.now() - 60_000).toISOString(),
  }
}

function post(body: unknown): Request {
  return new Request('https://fn/aanvulling-toevoegen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify(body),
  })
}

function deps(over: Partial<Deps> = {}): Deps {
  return { env, db: fakeDb(), asana: fakeAsana(), storage: null, fields: cfg, log: () => {}, ...over }
}

// ── De regels zelf ───────────────────────────────────────────────────────────

Deno.test('types worden aangevuld, nooit vervangen', () => {
  const w = bepaalWijziging(
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: ['vlaggen'], anders_tekst: '', nieuwe_event_datum: null, nieuwe_deadline: null, schijf_locatie: '', link: '' },
    aanvraag(),
    // In Asana staat inmiddels ook een menukaart die Marketing er zelf bij zette.
    { 'f-type': { optieGids: ['o-led', 'o-menu'], datum: null, tekst: null } },
    cfg,
  )
  assertEquals(w.velden['f-type'], ['o-led', 'o-menu', 'o-vlag'])
  assertEquals(w.bijgewerkt, ['Type aanvraag'])
})

Deno.test('een type dat er al staat levert geen wijziging op', () => {
  const w = bepaalWijziging(
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: ['led_kolom'], anders_tekst: '', nieuwe_event_datum: null, nieuwe_deadline: null, schijf_locatie: '', link: '' },
    aanvraag(),
    { 'f-type': { optieGids: ['o-led'], datum: null, tekst: null } },
    cfg,
  )
  assertEquals(w.velden, {})
  assertEquals(w.bijgewerkt, [])
})

Deno.test('een datum die niet verschuift wordt niet meegestuurd', () => {
  const w = bepaalWijziging(
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: [], anders_tekst: '', nieuwe_event_datum: '2026-12-01', nieuwe_deadline: '2026-11-25', schijf_locatie: '', link: '' },
    aanvraag(),
    {},
    cfg,
  )
  assertEquals(w.velden['f-event'], undefined)
  assertEquals(w.velden['f-deadline'], { date: '2026-11-25' })
  assertEquals(w.bijgewerkt, ['Deadline'])
})

Deno.test('schijf vult alleen een leeg veld; anders gaat het pad naar de reactie', () => {
  const leeg = bepaalWijziging(
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: [], anders_tekst: '', nieuwe_event_datum: null, nieuwe_deadline: null, schijf_locatie: 'G:\\Events\\Zorg', link: '' },
    aanvraag(),
    {},
    cfg,
  )
  assertEquals(leeg.velden['f-schijf'], 'G:\\Events\\Zorg')
  assertEquals(leeg.schijfNietOvergenomen, '')

  const bezet = bepaalWijziging(
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: [], anders_tekst: '', nieuwe_event_datum: null, nieuwe_deadline: null, schijf_locatie: 'G:\\Nieuw', link: '' },
    aanvraag(),
    { 'f-schijf': { optieGids: [], datum: null, tekst: 'G:\\Door Marketing gezet' } },
    cfg,
  )
  assertEquals(bezet.velden['f-schijf'], undefined)
  assertEquals(bezet.schijfNietOvergenomen, 'G:\\Nieuw')
})

// ── De function ──────────────────────────────────────────────────────────────

Deno.test('plaatst een reactie en werkt de velden bij', async () => {
  const db = fakeDb()
  const asana = fakeAsana()
  const res = await createHandler(deps({ db, asana }))(post(payload({ extra_types: ['vlaggen'], link: 'https://wetransfer.com/abc' })))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.bijgewerkt, ['Type aanvraag'])

  assertEquals(asana.velden.length, 1)
  assertEquals(asana.velden[0]['f-type'], ['o-led', 'o-vlag'])
  assertEquals(asana.comments.length, 1)
  assertStringIncludes(asana.comments[0], 'Aanvulling van Wendy Tester')
  assertStringIncludes(asana.comments[0], 'We willen er ook vlaggen bij.')
  assertStringIncludes(asana.comments[0], 'Bijgewerkt in deze taak:</strong> Type aanvraag')
  assertStringIncludes(asana.comments[0], 'wetransfer.com')
  // De eigen administratie beweegt mee, zodat een volgende aanvulling van de juiste stand uitgaat.
  assertEquals(db.patches[0], { aanvraag_types: ['led_kolom', 'vlaggen'] })
})

Deno.test('de vervaldatum en spoed van de taak blijven onaangeroerd', async () => {
  const asana = fakeAsana()
  await createHandler(deps({ asana }))(post(payload({ nieuwe_deadline: '2026-11-10' })))
  const gezet = Object.keys(asana.velden[0] ?? {})
  assertEquals(gezet, ['f-deadline'])
})

Deno.test('een onbekende aanvraag geeft 404', async () => {
  const res = await createHandler(deps({ db: fakeDb(null) }))(post(payload()))
  assertEquals(res.status, 404)
  assertMatch((await res.json()).error, /niet meer vinden/)
})

Deno.test('een aanvraag zonder Asana-taak geeft 409', async () => {
  const res = await createHandler(deps({ db: fakeDb(aanvraag({ asana_task_gid: null })) }))(post(payload()))
  assertEquals(res.status, 409)
})

Deno.test('een vervallen aanvraag krijgt geen aanvulling meer', async () => {
  // Het zoekscherm laat hem niet meer zien, maar een formulier dat al openstond wel.
  const db = fakeDb(aanvraag({ vervallen_op: '2026-09-16T10:00:00.000Z' }))
  const asana = fakeAsana()
  const res = await createHandler(deps({ db, asana }))(post(payload()))
  assertEquals(res.status, 409)
  assertMatch((await res.json()).error, /niet meer open/)
  assertEquals(db.aanvullingen, [])
  assertEquals(asana.comments, [])
})

Deno.test('een deadline na het event wordt geweigerd, ook als alleen de deadline schuift', async () => {
  const res = await createHandler(deps())(post(payload({ nieuwe_deadline: '2026-12-15' })))
  assertEquals(res.status, 400)
  assertEquals((await res.json()).field, 'aanvulling.nieuwe_deadline')
})

Deno.test('dezelfde client_request_id plaatst geen tweede reactie', async () => {
  const db = fakeDb()
  const asana = fakeAsana()
  const handler = createHandler(deps({ db, asana }))
  const p = payload({ extra_types: ['vlaggen'] })
  const eerste = await handler(post(p))
  const tweede = await handler(post(p))
  assertEquals(eerste.status, 200)
  assertEquals(tweede.status, 200)
  assertEquals(asana.comments.length, 1)
  assertEquals(db.aanvullingen.length, 1)
  assertEquals((await tweede.json()).bijgewerkt, ['Type aanvraag'])
})

Deno.test('de honeypot bewaart niets maar doet alsof het lukte', async () => {
  const db = fakeDb()
  const asana = fakeAsana()
  const res = await createHandler(deps({ db, asana }))(post({ ...payload(), website_confirm: 'ik ben een bot' }))
  assertEquals(res.status, 200)
  assertEquals(db.aanvullingen.length, 0)
  assertEquals(asana.comments.length, 0)
})

Deno.test('te snel ingevuld wordt net zo behandeld', async () => {
  const db = fakeDb()
  const res = await createHandler(deps({ db }))(post({ ...payload(), started_at: new Date().toISOString() }))
  assertEquals(res.status, 200)
  assertEquals(db.aanvullingen.length, 0)
})

Deno.test('een te korte toelichting geeft een bruikbare foutmelding', async () => {
  const res = await createHandler(deps())(post(payload({ toelichting: 'ja' })))
  assertEquals(res.status, 400)
  const body = await res.json()
  assertEquals(body.field, 'aanvulling.toelichting')
  assertMatch(body.error, /kort wat er moet veranderen/)
})

Deno.test('mislukt het bijwerken van velden, dan komt de reactie er alsnog', async () => {
  const db = fakeDb()
  const asana = fakeAsana({}, { veldWaarschuwing: ['velden niet gezet: deadline (400: invalid)'] })
  const res = await createHandler(deps({ db, asana }))(post(payload({ extra_types: ['vlaggen'] })))
  assertEquals(res.status, 200)
  assertEquals(asana.comments.length, 1)
  assertMatch(db.aanvullingen[0].asana_error ?? '', /velden niet gezet/)
})

Deno.test('lukt de reactie niet, dan weet de aanvrager dat', async () => {
  const db = fakeDb()
  const res = await createHandler(deps({ db, asana: fakeAsana({}, { commentFail: true }) }))(post(payload()))
  assertEquals(res.status, 502)
  // De aanvulling is wél bewaard, met de reden erbij.
  assertEquals(db.aanvullingen.length, 1)
  assertMatch(db.aanvullingen[0].asana_error ?? '', /reactie plaatsen mislukt/)
})

Deno.test('te veel aanvullingen achter elkaar geeft 429', async () => {
  const db = fakeDb()
  const handler = createHandler(deps({ db }))
  for (let i = 0; i < env.rateLimitIpPerHour; i++) await handler(post(payload()))
  const res = await handler(post(payload()))
  assertEquals(res.status, 429)
})

Deno.test('OPTIONS en een verkeerde methode', async () => {
  const handler = createHandler(deps())
  assertEquals((await handler(new Request('https://fn', { method: 'OPTIONS', headers: { Origin: 'https://marketing-nbc.github.io' } }))).status, 204)
  assertEquals((await handler(new Request('https://fn', { method: 'GET' }))).status, 405)
})

// ── Heropenen van afgerond werk ──────────────────────────────────────────────

Deno.test('een taak in Klaar gaat terug naar Feedback en wordt heropend', async () => {
  const db = fakeDb()
  const asana = fakeAsana({ memberships: [{ project: '111', section: 'sec-klaar' }], assignee: 'abel' })
  const res = await createHandler(deps({ db, asana }))(post(payload()))

  assertEquals(res.status, 200)
  assertEquals(asana.heropend, 1)
  assertEquals(asana.verplaatst, ['sec-feedback'])
  // Met een vermelding, zodat het in de Asana-inbox landt.
  assertStringIncludes(asana.comments[0], '<a data-asana-gid="abel"/>')
  assertStringIncludes(asana.comments[0], 'was al afgerond en is heropend')
  // En de vraag om een nieuwe datum, want de webhook stelt die maar één keer per taak.
  assertStringIncludes(asana.comments[0], 'planningsdatum is eraf gehaald')
})

Deno.test('een afgevinkte taak telt net zo goed als afgerond', async () => {
  // Staat in Mee bezig, maar het vinkje staat aan. Ook dan kijkt niemand er nog naar om.
  const asana = fakeAsana({ completed: true, memberships: [{ project: '111', section: 'sec-bezig' }] })
  await createHandler(deps({ asana }))(post(payload()))
  assertEquals(asana.heropend, 1)
  assertEquals(asana.verplaatst, ['sec-feedback'])
})

Deno.test('werk waar Marketing middenin zit blijft staan waar het staat', async () => {
  const asana = fakeAsana({ completed: false, memberships: [{ project: '111', section: 'sec-bezig' }] })
  await createHandler(deps({ asana }))(post(payload()))
  assertEquals(asana.heropend, 0)
  assertEquals(asana.verplaatst, [])
  assertEquals(asana.comments[0].includes('heropend'), false)
})

Deno.test('de sectie komt uit ons eigen project, niet uit de werkplanning', async () => {
  // In de werkplanning staat hij in een kolom die toevallig "sec-klaar" heet; dat mag niet meetellen.
  const asana = fakeAsana({
    memberships: [
      { project: 'werkplanning', section: 'sec-klaar' },
      { project: '111', section: 'sec-bezig' },
    ],
  })
  await createHandler(deps({ asana }))(post(payload()))
  assertEquals(asana.heropend, 0)
  assertEquals(asana.verplaatst, [])
})

Deno.test('zonder kolom Feedback gaat het vinkje er alsnog af', async () => {
  const db = fakeDb()
  const zonderFeedback = { ...cfg, sections: { klaar: { gid: 'sec-klaar', name: 'Klaar' } } }
  const asana = fakeAsana({ memberships: [{ project: '111', section: 'sec-klaar' }] })
  const res = await createHandler(deps({ db, asana, fields: zonderFeedback }))(post(payload()))

  assertEquals(res.status, 200)
  assertEquals(asana.heropend, 1)
  assertEquals(asana.verplaatst, [])
  assertMatch(db.aanvullingen[0].asana_error ?? '', /kolom Feedback bestaat nog niet/)
})

Deno.test('mislukt het verplaatsen, dan komt de aanvulling er alsnog', async () => {
  const db = fakeDb()
  const asana = fakeAsana({ memberships: [{ project: '111', section: 'sec-klaar' }] }, { verplaatsFail: true })
  const res = await createHandler(deps({ db, asana }))(post(payload()))

  assertEquals(res.status, 200)
  assertEquals(asana.comments.length, 1)
  assertMatch(db.aanvullingen[0].asana_error ?? '', /verplaatsen mislukt/)
})

Deno.test('lukt het ophalen van de taak niet, dan heropenen we niets', async () => {
  // Zonder de taak weten we niet of hij afgerond was; dan maar niets aanraken.
  const asana = fakeAsana()
  const kapot = Object.assign(asana, { getTask: () => Promise.reject(new Error('Asana plat')) })
  await createHandler(deps({ asana: kapot }))(post(payload()))
  assertEquals(asana.heropend, 0)
  assertEquals(asana.verplaatst, [])
})
