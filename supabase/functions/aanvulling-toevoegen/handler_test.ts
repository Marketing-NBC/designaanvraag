import { assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import type { AsanaFieldsConfig, AsanaTask } from '../_shared/asana.ts'
import type { AanvraagDetail, AanvullingRow, Db, NewAanvulling } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import type { AanvullingInput } from '../_shared/shared/aanvulling-schema.ts'
import type { MailBericht } from '../_shared/shared/mail.ts'
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
    menuRoutineFireUrl: null,
    menuRoutineToken: null,
    msTenantId: null,
    msClientId: null,
    msClientSecret: null,
    mailAfzender: null,
}

/** Eigen mapping met herkenbare gids, zodat een assertie leest als de bedoeling. */
const cfg: AsanaFieldsConfig = {
  project: { gid: '111' },
  assignee: { gid: '222' },
  sections: {
    nieuwe_aanvragen: { gid: 'sec-nieuw', name: 'Nieuwe aanvragen' },
    feedback: { gid: 'sec-feedback', name: 'Feedback' },
    in_planning: { gid: 'sec-planning', name: 'In planning' },
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
    asana_deadline_gid: null,
    spoed: false,
    werkdagen_tot_event: 30,
    brand_status: 'done',
    brand_error: null,
    brand_session_url: null,
    menu_status: 'pending' as const,
    menu_error: null,
    menu_kleuren: 'nbc' as const,
    vervallen_op: null,
    naam: 'Britt',
    locatie: 'nbc',
    soort: 'evenement',
    omschrijving: '',
    event: 'Zorgcongres 2026',
    event_datum: '2026-12-01',
    deadline: '2026-11-20',
    aanvraag_types: ['led_kolom'],
    anders_tekst: '',
    schijf_locatie: '',
    menu_pakket: '',
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
    findById: (id) => Promise.resolve(row && row.id === id ? row : null),
    zoekOpEvent: () => Promise.resolve([]),
    zoekInternOpNaam: () => Promise.resolve([]),
    markeerVervallen: () => Promise.resolve(false),
    deadlineVan: () => Promise.resolve(null),
    findByAsanaTaskGid: () => Promise.resolve(null),
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
    zoekOpId: () => Promise.resolve(null),
    findDetailByAsanaTaskGid: () => Promise.resolve(null),
    collegaEmail: () => Promise.resolve(null),
    findOplevering: () => Promise.resolve(null),
    aantalVerstuurd: () => Promise.resolve(0),
    insertOplevering: () => Promise.reject(new Error('niet gebruikt')),
    updateOplevering: () => Promise.resolve(),
    heropenOplevering: () => Promise.reject(new Error('niet gebruikt')),
  }
  return db
}

function fakeAsana(taak: Partial<AsanaTask> = {}, opts: { commentFail?: boolean; veldWaarschuwing?: string[]; verplaatsFail?: boolean } = {}) {
  const velden: Record<string, unknown>[] = []
  const comments: string[] = []
  const verplaatst: string[] = []
  let heropend = 0
  const taakBeschrijving = { html: '<body><h2>Menu</h2>\n<blockquote>Oud menu</blockquote>\n<hr/>\n<h2>Huisstijl</h2>\nx</body>', gezet: 0 }
  return {
    velden,
    comments,
    verplaatst,
    taakBeschrijving,
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
    bijwerkDeadline: () => Promise.resolve(),
    verwijderTaak: () => Promise.resolve(),
    listSubtaken: () => Promise.resolve([]),
    maakSubtaak: () => Promise.resolve('sub-x'),
    werkTaakBij: () => Promise.resolve(),
    listBestanden: () => Promise.resolve([]),
    downloadBestand: () => Promise.reject(new Error('niet gebruikt')),
    rondAf: () => Promise.resolve(),
    gebruiker: () => Promise.resolve({ naam: null, email: null }),
    beschrijving: () => Promise.resolve(taakBeschrijving.html),
    zetBeschrijving: (_gid: string, html: string) => {
      taakBeschrijving.html = html
      taakBeschrijving.gezet++
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
    started_at: new Date(VANDAAG.getTime() - 60_000).toISOString(),
  }
}

function post(body: unknown): Request {
  return new Request('https://fn/aanvulling-toevoegen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify(body),
  })
}

/** Een vaste dag, zodat de deadline van de testaanvraag (20 november) niet vanzelf verloopt. */
const VANDAAG = new Date('2026-10-26T10:00:00+01:00')

function deps(over: Partial<Deps> = {}): Deps {
  return { env, db: fakeDb(), asana: fakeAsana(), storage: null, fields: cfg, now: () => VANDAAG, log: () => {}, ...over }
}

// ── De regels zelf ───────────────────────────────────────────────────────────

Deno.test('types worden aangevuld, nooit vervangen', () => {
  const w = bepaalWijziging(
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: ['vlaggen'], anders_tekst: '', nieuwe_event_datum: null, nieuwe_deadline: null, schijf_locatie: '', link: '', menu_inhoud: null, menu_tekst: '' },
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
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: ['led_kolom'], anders_tekst: '', nieuwe_event_datum: null, nieuwe_deadline: null, schijf_locatie: '', link: '', menu_inhoud: null, menu_tekst: '' },
    aanvraag(),
    { 'f-type': { optieGids: ['o-led'], datum: null, tekst: null } },
    cfg,
  )
  assertEquals(w.velden, {})
  assertEquals(w.bijgewerkt, [])
})

Deno.test('een datum die niet verschuift wordt niet meegestuurd', () => {
  const w = bepaalWijziging(
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: [], anders_tekst: '', nieuwe_event_datum: '2026-12-01', nieuwe_deadline: '2026-11-25', schijf_locatie: '', link: '', menu_inhoud: null, menu_tekst: '' },
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
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: [], anders_tekst: '', nieuwe_event_datum: null, nieuwe_deadline: null, schijf_locatie: 'G:\\Events\\Zorg', link: '', menu_inhoud: null, menu_tekst: '' },
    aanvraag(),
    {},
    cfg,
  )
  assertEquals(leeg.velden['f-schijf'], 'G:\\Events\\Zorg')
  assertEquals(leeg.schijfNietOvergenomen, '')

  const bezet = bepaalWijziging(
    { aanvraag_id: AANVRAAG_ID, naam: 'W', toelichting: 'x', extra_types: [], anders_tekst: '', nieuwe_event_datum: null, nieuwe_deadline: null, schijf_locatie: 'G:\\Nieuw', link: '', menu_inhoud: null, menu_tekst: '' },
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

Deno.test('een verlopen deadline moet vervangen worden', async () => {
  const verlopen = () => fakeDb(aanvraag({ deadline: '2026-10-20' }))
  const zonder = await createHandler(deps({ db: verlopen() }))(post(payload()))
  assertEquals(zonder.status, 400)
  const fout = await zonder.json()
  assertEquals(fout.field, 'aanvulling.nieuwe_deadline')
  assertMatch(fout.error, /verstreken/)

  const db = verlopen()
  const met = await createHandler(deps({ db }))(post(payload({ nieuwe_deadline: '2026-11-02' })))
  assertEquals(met.status, 200)
  assertEquals(db.patches, [{ deadline: '2026-11-02' }])
})

Deno.test('zonder deadline kan er niets verlopen, en kan er alsnog een bij', async () => {
  const zonder = () => fakeDb(aanvraag({ soort: 'intern', event: '', event_datum: null, deadline: null }))
  const res = await createHandler(deps({ db: zonder() }))(post(payload()))
  assertEquals(res.status, 200)

  const db = zonder()
  await createHandler(deps({ db }))(post(payload({ nieuwe_deadline: '2026-11-25' })))
  assertEquals(db.patches, [{ deadline: '2026-11-25' }])
})

Deno.test('een nieuwe deadline in het verleden wordt geweigerd', async () => {
  const res = await createHandler(deps())(post(payload({ nieuwe_deadline: '2026-10-01' })))
  assertEquals(res.status, 400)
  assertMatch((await res.json()).error, /al geweest/)
})

Deno.test('is het event al geweest, dan mag de nieuwe deadline erna liggen', async () => {
  const db = fakeDb(aanvraag({ event_datum: '2026-10-10', deadline: '2026-10-05' }))
  const res = await createHandler(deps({ db }))(post(payload({ nieuwe_deadline: '2026-11-02' })))
  assertEquals(res.status, 200)
})

Deno.test('een interne aanvraag heeft geen eventdatum om te verschuiven', async () => {
  const db = fakeDb(aanvraag({ soort: 'intern', event: '', event_datum: null, aanvraag_types: [] }))
  const asana = fakeAsana({ customFields: {} })
  const res = await createHandler(deps({ db, asana }))(post(payload({ nieuwe_event_datum: '2026-12-01', nieuwe_deadline: '2026-11-25' })))
  assertEquals(res.status, 200)
  // Alleen de deadline gaat naar Asana; een eventdatum hoort niet bij een interne aanvraag.
  assertEquals(asana.velden, [{ 'f-deadline': { date: '2026-11-25' } }])
  assertEquals(db.aanvullingen[0].nieuwe_event_datum, null)
  assertEquals(db.patches, [{ deadline: '2026-11-25' }])
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
  const res = await createHandler(deps({ db }))(post({ ...payload(), started_at: VANDAAG.toISOString() }))
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
  // Staat in In planning, maar het vinkje staat aan. Ook dan kijkt niemand er nog naar om.
  const asana = fakeAsana({ completed: true, memberships: [{ project: '111', section: 'sec-planning' }] })
  await createHandler(deps({ asana }))(post(payload()))
  assertEquals(asana.heropend, 1)
  assertEquals(asana.verplaatst, ['sec-feedback'])
})

Deno.test('in Nieuwe aanvragen en In planning blijft de taak staan waar hij staat', async () => {
  for (const section of ['sec-nieuw', 'sec-planning']) {
    const asana = fakeAsana({ completed: false, memberships: [{ project: '111', section }] })
    await createHandler(deps({ asana }))(post(payload()))
    assertEquals(asana.heropend, 0)
    assertEquals(asana.verplaatst, [])
    assertEquals(asana.comments[0].includes('Feedback'), false)
  }
})

Deno.test('de sectie komt uit ons eigen project, niet uit de werkplanning', async () => {
  // In de werkplanning staat hij in een kolom die toevallig "sec-klaar" heet; dat mag niet meetellen.
  const asana = fakeAsana({
    memberships: [
      { project: 'werkplanning', section: 'sec-klaar' },
      { project: '111', section: 'sec-nieuw' },
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

// ── Meldingsmail ──────────────────────────────────────────────────────────────

function fakeMail(opts: { fail?: boolean } = {}) {
  const verstuurd: MailBericht[] = []
  return {
    verstuurd,
    async verstuur(b: MailBericht) {
      if (opts.fail) throw new Error('Mail versturen mislukt (403: ErrorAccessDenied)')
      verstuurd.push(b)
    },
  }
}

Deno.test('een aanvulling geeft een mail met de taak, de tekst en de Asana-link', async () => {
  const mail = fakeMail()
  const res = await createHandler(deps({ mail }))(post(payload({ extra_types: ['vlaggen'], nieuwe_deadline: '2026-11-25' })))
  assertEquals(res.status, 200)
  const [m] = mail.verstuurd
  assertEquals(m.aan, ['marketing@nbcevents.nl'])
  assertEquals(m.onderwerp, 'Aanvulling: Zorgcongres 2026 - 1 december - LED-kolom, Vlaggen')
  // De taaknaam zoals hij in Asana staat.
  assertStringIncludes(m.html, '>Zorgcongres 2026</p>')
  assertStringIncludes(m.html, 'Aanvulling van Wendy Tester')
  assertStringIncludes(m.html, 'We willen er ook vlaggen bij.')
  assertStringIncludes(m.html, 'Britt')
  assertStringIncludes(m.html, 'href="https://app.asana.com/0/111/999"')
  assertStringIncludes(m.html, 'Erbij gevraagd')
  assertMatch(m.html, /25 november 2026<\/strong> <span[^>]*>\(gewijzigd\)/)
})

Deno.test('een aanvulling op een spoedje van Green Village', async () => {
  const mail = fakeMail()
  const db = fakeDb(aanvraag({ spoed: true, locatie: 'green_village' }))
  await createHandler(deps({ db, mail }))(post(payload()))
  assertEquals(mail.verstuurd[0].aan, ['marketing@green-village.nl'])
  assertMatch(mail.verstuurd[0].onderwerp, /^\[SPOED\] Aanvulling: /)
})

Deno.test('de mail zegt het als een afgeronde taak is heropend', async () => {
  const mail = fakeMail()
  const asana = fakeAsana({ memberships: [{ project: '111', section: 'sec-klaar' }] })
  await createHandler(deps({ asana, mail }))(post(payload()))
  assertStringIncludes(mail.verstuurd[0].html, 'was al afgerond en is heropend')
})

Deno.test('lukt de reactie niet, dan staat de aanvulling in elk geval in de mail', async () => {
  const mail = fakeMail()
  const res = await createHandler(deps({ mail, asana: fakeAsana({}, { commentFail: true }) }))(post(payload()))
  assertEquals(res.status, 502)
  const [m] = mail.verstuurd
  assertMatch(m.onderwerp, /^\[Niet in Asana\] Aanvulling: /)
  assertStringIncludes(m.html, 'We willen er ook vlaggen bij.')
  assertStringIncludes(m.html, 'Not Authorized')
})

Deno.test('een mislukte mail houdt de aanvulling niet tegen', async () => {
  const asana = fakeAsana()
  const res = await createHandler(deps({ asana, mail: fakeMail({ fail: true }) }))(post(payload()))
  assertEquals(res.status, 200)
  assertEquals(asana.comments.length, 1)
})

Deno.test('een geweigerde aanvulling mailt niet', async () => {
  const mail = fakeMail()
  const db = fakeDb(aanvraag({ vervallen_op: '2026-10-01T00:00:00Z' }))
  await createHandler(deps({ db, mail }))(post(payload()))
  assertEquals(mail.verstuurd.length, 0)
})

Deno.test('een aanvulling op een interne aanvraag mailt zonder event', async () => {
  const mail = fakeMail()
  const db = fakeDb(aanvraag({ soort: 'intern', event: '', event_datum: null, aanvraag_types: [], omschrijving: 'Nieuwe visitekaartjes voor het salesteam' }))
  const res = await createHandler(deps({ db, mail }))(post(payload()))
  assertEquals(res.status, 200)
  const [m] = mail.verstuurd
  assertEquals(m.onderwerp, 'Aanvulling: Intern - Nieuwe visitekaartjes voor het salesteam')
  assertEquals(m.html.includes('Eventdatum'), false)
})

// ── Menu aanpassen ───────────────────────────────────────────────────────────

const nieuwMenu = {
  pakket: 'lunch-basic',
  secties: [{ kop: 'Broodjes', gerechten: [{ naam: 'Clubsandwich', ingredienten: ['kip', 'bacon'] }] }],
}
const menuAanvraag = () => fakeDb(aanvraag({ aanvraag_types: ['menu_scherm'], menu_pakket: 'grab-and-go' }))

Deno.test('een aangepast menu komt bij de aanvraag, zodat het volgende menuscherm het gebruikt', async () => {
  const db = menuAanvraag()
  const asana = fakeAsana()
  const res = await createHandler(deps({ db, asana }))(post(payload({ menu_inhoud: nieuwMenu, menu_tekst: 'Broodjes\n• Clubsandwich | kip | bacon' })))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).bijgewerkt, ['Menu'])
  assertEquals(db.patches[0], { menu_inhoud: nieuwMenu, menu_tekst: 'Broodjes\n• Clubsandwich | kip | bacon', menu_pakket: 'lunch-basic' })
  // In de reactie: het nieuwe pakket, het oude, en wat Marketing nu moet doen.
  assertStringIncludes(asana.comments[0], 'Menu aangepast</strong>, pakket Basic Lunch (was Grab &amp; Go)')
  assertStringIncludes(asana.comments[0], 'Genereer nu')
  assertStringIncludes(asana.comments[0], 'Clubsandwich | kip | bacon')
  // En in de taakbeschrijving, want daar maakt "Genereer nu" het scherm van.
  assertStringIncludes(asana.taakBeschrijving.html, '<h2>Menu</h2>\n<blockquote>Broodjes\n• Clubsandwich | kip | bacon</blockquote>')
  assertEquals(asana.taakBeschrijving.html.includes('Oud menu'), false)
  assertStringIncludes(asana.taakBeschrijving.html, '<h2>Huisstijl</h2>')
})

Deno.test('zonder menuwijziging blijft de taakbeschrijving onaangeroerd', async () => {
  const asana = fakeAsana()
  await createHandler(deps({ db: menuAanvraag(), asana }))(post(payload()))
  assertEquals(asana.taakBeschrijving.gezet, 0)
})

Deno.test('alleen het menu aanpassen mag zonder toelichting', async () => {
  const res = await createHandler(deps({ db: menuAanvraag() }))(post(payload({ toelichting: '', menu_inhoud: nieuwMenu, menu_tekst: 'x' })))
  assertEquals(res.status, 200)
  const zonder = await createHandler(deps({ db: menuAanvraag() }))(post(payload({ toelichting: '' })))
  assertEquals(zonder.status, 400)
})

Deno.test('een menu aanpassen zonder menukaart of menuscherm in de aanvraag wordt geweigerd', async () => {
  const db = fakeDb()
  const res = await createHandler(deps({ db }))(post(payload({ menu_inhoud: nieuwMenu, menu_tekst: 'x' })))
  assertEquals(res.status, 400)
  assertEquals((await res.json()).field, 'aanvulling.menu_inhoud')
  assertEquals(db.patches, [])
})

Deno.test('hetzelfde pakket: geen "was" in de reactie, en de mail toont het nieuwe menu', async () => {
  const asana = fakeAsana()
  const mail = fakeMail()
  const db = fakeDb(aanvraag({ aanvraag_types: ['menu_scherm'], menu_pakket: 'lunch-basic' }))
  await createHandler(deps({ db, asana, mail }))(post(payload({ menu_inhoud: nieuwMenu, menu_tekst: 'Broodjes' })))
  assertStringIncludes(asana.comments[0], 'pakket Basic Lunch.')
  assertStringIncludes(mail.verstuurd[0].html, 'Nieuw menu: Basic Lunch')
})
