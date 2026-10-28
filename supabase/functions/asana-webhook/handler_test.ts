import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import type { AsanaFieldsConfig, AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import { ASK_DATE_MARKER, createHandler, hmacHex, type WebhookStore } from './handler.ts'

const TOKEN = 'tok123'
const RESOURCE = 'proj1'
const SECRET = 'geheim'

const cfg: AsanaFieldsConfig = {
  project: { gid: 'proj1', name: 'Designaanvragen' },
  assignee: { gid: 'abel' },
  fields: {
    deadline: { gid: 'veld-deadline', name: 'Deadline', type: 'date' },
    menuscherm: {
      gid: 'veld-menu',
      name: 'Menuscherm',
      type: 'enum',
      options: { genereer: 'opt-genereer', genereer_kleur: 'opt-genereer-kleur',
                 bezig: 'opt-bezig', klaar_menu: 'opt-klaar', mislukt: 'opt-mislukt' },
    },
    huisstijl: {
      gid: 'veld-huisstijl',
      name: 'Huisstijl',
      type: 'enum',
      options: { opnieuw: 'opt-opnieuw', bezig: 'opt-hs-bezig',
                 klaar_huisstijl: 'opt-hs-klaar', mislukt: 'opt-hs-mislukt' },
    },
    oplevermail: {
      gid: 'veld-oplever',
      name: 'Oplevermail',
      type: 'enum',
      options: { proef: 'opt-proef', verstuur: 'opt-verstuur', bezig: 'opt-op-bezig', proef_verstuurd: 'opt-proef-verstuurd', verstuurd: 'opt-verstuurd', mislukt: 'opt-op-mislukt' },
    },
  },
  sections: {
    nieuwe_aanvragen: { gid: 'sec-nieuw' },
    in_planning: { gid: 'sec-plan' },
    klaar: { gid: 'sec-klaar' },
  },
  planning_project: { gid: 'werk1', name: '4. Werkplanning' },
}

function fakeStore(secrets: string[] = [SECRET]): WebhookStore & { saved: [string, string][] } {
  const saved: [string, string][] = []
  return {
    saved,
    async getSecrets() {
      return secrets
    },
    async saveSecret(resource, secret) {
      saved.push([resource, secret])
    },
  }
}

function fakeAsana(tasks: Record<string, Partial<AsanaTask>>, comments: Record<string, string[]> = {}) {
  const added: [string, string][] = []
  const posted: [string, string][] = []
  const gezet: [string, Record<string, unknown>][] = []
  const mijlpalen: [string, { dueOn: string; completed: boolean }][] = []
  const verwijderd: string[] = []
  const vinkjes: [string, boolean | undefined][] = []
  const client: AsanaTaskClient = {
    async getTask(gid) {
      const t = tasks[gid]
      if (!t) throw new Error(`Asana-taak ${gid} ophalen mislukt (404: Not Found)`)
      return { gid, name: 'x', dueOn: null, completed: false, assignee: 'abel', projects: ['proj1'], memberships: [{ project: 'proj1', section: 'sec-nieuw' }], customFields: {}, ...t }
    },
    async addToProject(taskGid, projectGid) {
      added.push([taskGid, projectGid])
      tasks[taskGid] = { ...tasks[taskGid], projects: [...(tasks[taskGid]?.projects ?? ['proj1']), projectGid] }
    },
    async listComments(taskGid) {
      return [...(comments[taskGid] ?? []), ...posted.filter(([g]) => g === taskGid).map(([, h]) => h)]
    },
    async addComment(taskGid, html) {
      posted.push([taskGid, html])
    },
    async updateCustomFields(taskGid, velden) {
      gezet.push([taskGid, velden])
      return []
    },
    uploadAttachment: () => Promise.resolve({ gid: 'att-1', url: null }),
    moveToSection: () => Promise.resolve(),
    heropen: () => Promise.resolve(),
    async bijwerkDeadline(gid, stand) {
      mijlpalen.push([gid, stand])
    },
    async verwijderTaak(gid) {
      verwijderd.push(gid)
    },
    listSubtaken: () => Promise.resolve([]),
    maakSubtaak: () => Promise.resolve('sub-x'),
    async werkTaakBij(gid, stand) {
      vinkjes.push([gid, stand.completed])
      tasks[gid] = { ...tasks[gid], completed: stand.completed ?? tasks[gid]?.completed }
    },
    listBestanden: () => Promise.resolve([]),
    downloadBestand: () => Promise.reject(new Error('niet gebruikt')),
    rondAf: () => Promise.resolve(),
    gebruiker: () => Promise.resolve({ naam: null, email: null }),
  }
  return { client, added, posted, gezet, mijlpalen, verwijderd, vinkjes }
}

function setup(tasks: Record<string, Partial<AsanaTask>>, opts: {
  comments?: Record<string, string[]>
  secrets?: string[]
  aanvragen?: string[]
  zonderRoutine?: boolean
  mijlpalen?: Record<string, string>
  oplever?: (t: AsanaTask, opties: { proef: boolean; door: string | null }) => Promise<string>
  achtergrond?: (werk: Promise<unknown>) => void
} = {}) {
  const store = fakeStore(opts.secrets)
  const asana = fakeAsana(tasks, opts.comments)
  // Welke taken een aanvraag in onze database hebben; standaard allemaal die in `tasks` staan.
  const bekend = new Set(opts.aanvragen ?? Object.keys(tasks))
  const vervallen: [string, string][] = []
  const gestart: string[] = []
  const handler = createHandler({
    startMenu: opts.zonderRoutine ? undefined : (gid, kleuren) => {
      if (!bekend.has(gid)) return Promise.resolve(false)
      gestart.push(`${gid}:${kleuren}`)
      return Promise.resolve(true)
    },
    startHuisstijl: opts.zonderRoutine ? undefined : (gid) => {
      if (!bekend.has(gid)) return Promise.resolve(false)
      gestart.push(`${gid}:huisstijl`)
      return Promise.resolve(true)
    },
    token: TOKEN,
    store,
    asana: asana.client,
    cfg,
    log: () => {},
    now: () => new Date('2026-09-16T10:00:00Z'),
    markeerVervallen: (gid, moment) => {
      if (!bekend.has(gid)) return Promise.resolve(false)
      vervallen.push([gid, moment.toISOString()])
      return Promise.resolve(true)
    },
    deadlineVan: opts.mijlpalen ? (gid) => Promise.resolve(opts.mijlpalen?.[gid] ?? null) : undefined,
    oplever: opts.oplever,
    achtergrond: opts.achtergrond,
  })
  return { handler, store, asana, vervallen, gestart }
}

async function signed(events: unknown[], secret = SECRET, token = TOKEN): Promise<Request> {
  const body = JSON.stringify({ events })
  return new Request(`https://x.supabase.co/functions/v1/asana-webhook?resource=${RESOURCE}&token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hook-Signature': await hmacHex(secret, body) },
    body,
  })
}

const movedToPlanning = (gid: string) => ({ action: 'added', resource: { gid, resource_type: 'task' }, parent: { gid: 'sec-plan', resource_type: 'section' } })
const dueChanged = (gid: string) => ({ action: 'changed', resource: { gid, resource_type: 'task' }, change: { field: 'due_on', action: 'changed' } })
const verwijderd = (gid: string) => ({ action: 'deleted', resource: { gid, resource_type: 'task' } })
const uitProject = (gid: string, project = 'proj1') => ({ action: 'removed', resource: { gid, resource_type: 'task' }, parent: { gid: project, resource_type: 'project' } })

Deno.test('handshake: secret bewaren en teruggeven, alleen met juiste token', async () => {
  const { handler, store } = setup({})
  const bad = await handler(new Request(`https://x/asana-webhook?resource=${RESOURCE}&token=fout`, { method: 'POST', headers: { 'X-Hook-Secret': 's1' } }))
  assertEquals(bad.status, 403)
  const ok = await handler(new Request(`https://x/asana-webhook?resource=${RESOURCE}&token=${TOKEN}`, { method: 'POST', headers: { 'X-Hook-Secret': 's1' } }))
  assertEquals(ok.status, 200)
  assertEquals(ok.headers.get('X-Hook-Secret'), 's1')
  assertEquals(store.saved, [[RESOURCE, 's1']])
})

Deno.test('ongeldige handtekening → 401, niets gedaan', async () => {
  const { handler, asana } = setup({ t1: { memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  const res = await handler(await signed([movedToPlanning('t1')], 'verkeerd'))
  assertEquals(res.status, 401)
  assertEquals(asana.posted, [])
})

Deno.test('naar In planning zonder datum → één comment met mention, niet twee keer', async () => {
  const { handler, asana } = setup({ t1: { memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  const res = await handler(await signed([movedToPlanning('t1')]))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).handled, { t1: 'datum gevraagd' })
  assertEquals(asana.posted.length, 1)
  assertMatch(asana.posted[0][1], /^<body><a data-asana-gid="abel"\/> kies een vervaldatum/)
  assertMatch(asana.posted[0][1], /4\. Werkplanning/)
  // Zelfde event nog een keer (Asana levert soms dubbel): geen tweede comment.
  const again = await handler(await signed([movedToPlanning('t1')]))
  assertEquals((await again.json()).handled, { t1: 'datum al gevraagd' })
  assertEquals(asana.posted.length, 1)
  assertEquals(asana.added, [])
})

Deno.test('datum gekozen in In planning → in werkplanning gezet, met bevestiging', async () => {
  const { handler, asana } = setup({ t1: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  const res = await handler(await signed([dueChanged('t1')]))
  assertEquals((await res.json()).handled, { t1: 'ingepland' })
  assertEquals(asana.added, [['t1', 'werk1']])
  assertMatch(asana.posted[0][1], /4\. Werkplanning met vervaldatum 20 oktober 2026/)
  // Nogmaals: al ingepland, niets dubbel.
  const again = await handler(await signed([dueChanged('t1')]))
  assertEquals((await again.json()).handled, { t1: 'al ingepland' })
  assertEquals(asana.added.length, 1)
})

Deno.test('datum in Nieuwe aanvragen, Feedback of Klaar → niets; alleen In planning plant in', async () => {
  const { handler, asana } = setup({
    nieuw: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-nieuw' }] },
    feedback: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-feedback' }] },
    klaar: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-klaar' }] },
    plan: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-plan' }] },
    ander: { dueOn: '2026-10-20', memberships: [{ project: 'proj9', section: 'x' }] },
  })
  const res = await handler(await signed([dueChanged('nieuw'), dueChanged('feedback'), dueChanged('klaar'), dueChanged('plan'), dueChanged('ander')]))
  const body = await res.json()
  assertEquals(body.handled.nieuw, 'datum, maar niet in planning')
  assertEquals(body.handled.feedback, 'datum, maar niet in planning')
  assertEquals(body.handled.klaar, 'datum, maar niet in planning')
  assertEquals(body.handled.plan, 'ingepland')
  assertEquals(body.handled.ander, 'niet in ons project')
  assertEquals(asana.added, [['plan', 'werk1']])
})

Deno.test('naar In planning zonder datum als de vraag al gesteld is → niets', async () => {
  const { handler, asana } = setup({ t1: { memberships: [{ project: 'proj1', section: 'sec-plan' }] } }, { comments: { t1: [`@Abel ${ASK_DATE_MARKER}. Zodra…`] } })
  await handler(await signed([movedToPlanning('t1')]))
  assertEquals(asana.posted, [])
})

Deno.test('fout bij één taak stopt de rest niet', async () => {
  const { handler, asana } = setup({ t2: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  const res = await handler(await signed([dueChanged('onbekend'), dueChanged('t2')]))
  const body = await res.json()
  assertMatch(body.handled.onbekend, /^fout: /)
  assertEquals(body.handled.t2, 'ingepland')
  assertEquals(asana.added, [['t2', 'werk1']])
})

Deno.test('GET en ontbrekende resource', async () => {
  const { handler } = setup({})
  assertEquals((await handler(new Request(`https://x/asana-webhook?token=${TOKEN}`, { method: 'GET' }))).status, 405)
  assertEquals((await handler(new Request(`https://x/asana-webhook?token=${TOKEN}`, { method: 'POST', body: '{}' }))).status, 400)
})

Deno.test('taak weggegooid → aanvraag vervalt, taak wordt niet meer opgehaald', async () => {
  const { handler, asana, vervallen } = setup({ t1: { memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  const res = await handler(await signed([verwijderd('t1')]))
  assertEquals((await res.json()).handled, { t1: 'aanvraag vervallen' })
  assertEquals(vervallen, [['t1', '2026-09-16T10:00:00.000Z']])
  // Niets gevraagd of geplaatst: de taak bestaat niet meer.
  assertEquals(asana.posted, [])
  assertEquals(asana.added, [])
})

Deno.test('taak uit ons project gehaald → vervalt; uit een ander project → niet', async () => {
  const { handler, vervallen } = setup({ t1: {}, t2: {} })
  const res = await handler(await signed([uitProject('t1'), uitProject('t2', 'werk1')]))
  const body = await res.json()
  assertEquals(body.handled.t1, 'aanvraag vervallen')
  assertEquals(body.handled.t2, undefined)
  assertEquals(vervallen.map(([gid]) => gid), ['t1'])
})

Deno.test('verwijderde taak zonder aanvraag bij ons → gemeld, geen fout', async () => {
  const { handler, vervallen } = setup({}, { aanvragen: [] })
  const res = await handler(await signed([verwijderd('vreemd')]))
  assertEquals((await res.json()).handled, { vreemd: 'geen aanvraag bij deze taak' })
  assertEquals(vervallen, [])
})

Deno.test('wijziging én verwijdering in één batch → alleen vervallen, geen ophaalfout', async () => {
  const { handler, vervallen } = setup({ t1: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  const res = await handler(await signed([dueChanged('t1'), verwijderd('t1')]))
  assertEquals((await res.json()).handled, { t1: 'aanvraag vervallen' })
  assertEquals(vervallen.length, 1)
})

// ── De knop "Genereer nu" ────────────────────────────────────────────
// Marketing hangt het logo aan de subtaak en zet daarna het veld Menuscherm om.
// Dat is het startsein; alles daarna gaat vanzelf.

const veldGewijzigd = (gid: string) => ({
  action: 'changed', resource: { gid, resource_type: 'task' },
  change: { field: 'custom_fields', action: 'changed' },
})

Deno.test('het veld op "Genereer nu" start de menu-routine', async () => {
  const { handler, asana, gestart } = setup({
    t1: { customFields: { 'veld-menu': { optieGids: ['opt-genereer'], datum: null, tekst: null } } },
  })
  const res = await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(res.status, 200)
  assertEquals(gestart, ['t1:nbc'])
  // En het veld gaat meteen op Bezig, zodat je ziet dat het loopt.
  assertEquals(asana.gezet, [['t1', { 'veld-menu': 'opt-bezig' }]])
})

Deno.test('een andere waarde in het veld start niets', async () => {
  for (const optie of ['opt-bezig', 'opt-klaar', 'opt-mislukt']) {
    const { handler, gestart } = setup({
      t1: { customFields: { 'veld-menu': { optieGids: [optie], datum: null, tekst: null } } },
    })
    await handler(await signed([veldGewijzigd('t1')]))
    assertEquals(gestart, [], `${optie} hoort niets te starten`)
  }
})

Deno.test('een afgeronde taak mag alsnog een menuscherm krijgen', async () => {
  // De knop staat los van de planning-flow: het scherm wordt vaak pas gemaakt als
  // het ontwerpwerk al afgevinkt is.
  const { handler, gestart } = setup({
    t1: { completed: true, customFields: { 'veld-menu': { optieGids: ['opt-genereer'], datum: null, tekst: null } } },
  })
  await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(gestart, ['t1:nbc'])
})

Deno.test('de tweede knop vraagt om de kleuren van de opdrachtgever', async () => {
  const { handler, gestart } = setup({
    t1: { customFields: { 'veld-menu': { optieGids: ['opt-genereer-kleur'], datum: null, tekst: null } } },
  })
  await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(gestart, ['t1:opdrachtgever'])
})

Deno.test('zonder ingestelde routine blijft het niet stil', async () => {
  const { handler, asana, gestart } = setup({
    t1: { customFields: { 'veld-menu': { optieGids: ['opt-genereer'], datum: null, tekst: null } } },
  }, { zonderRoutine: true })
  const res = await handler(await signed([veldGewijzigd('t1')]))
  const body = await res.json()
  assertEquals(gestart, [])
  assertEquals(asana.gezet, [], 'op Bezig zetten terwijl er niets loopt is misleidend')
  assertMatch(JSON.stringify(body), /Routine is niet ingesteld/)
})

// ── De knop "Haal opnieuw op" ─────────────────────────────────────────

Deno.test('de huisstijl opnieuw ophalen start de routine en zet de knop op Bezig', async () => {
  // Mislukte de huisstijl de eerste keer, dan stond de aanvraag op failed en kon
  // Marketing daar niets mee. Nu is het een knop.
  const { handler, gestart, asana } = setup({
    t1: { customFields: { 'veld-huisstijl': { optieGids: ['opt-opnieuw'], datum: null, tekst: null } } },
  })
  await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(gestart, ['t1:huisstijl'])
  assertEquals(asana.gezet, [['t1', { 'veld-huisstijl': 'opt-hs-bezig' }]],
    'op Bezig, zodat tweemaal klikken niets extra doet')
})

Deno.test('de andere standen van de huisstijl-knop starten niets', async () => {
  for (const optie of ['opt-hs-bezig', 'opt-hs-klaar', 'opt-hs-mislukt']) {
    const { handler, gestart } = setup({
      t1: { customFields: { 'veld-huisstijl': { optieGids: [optie], datum: null, tekst: null } } },
    })
    await handler(await signed([veldGewijzigd('t1')]))
    assertEquals(gestart, [], `${optie} hoort niets te starten`)
  }
})

Deno.test('de twee knoppen zitten elkaar niet in de weg', async () => {
  // Beide velden staan op de taak; alleen de knop die op zijn startstand staat telt.
  const { handler, gestart } = setup({
    t1: {
      customFields: {
        'veld-menu': { optieGids: ['opt-klaar'], datum: null, tekst: null },
        'veld-huisstijl': { optieGids: ['opt-opnieuw'], datum: null, tekst: null },
      },
    },
  })
  await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(gestart, ['t1:huisstijl'])
})

Deno.test('zonder aanvraag bij de taak zegt de huisstijl-knop dat', async () => {
  const { handler, asana } = setup({
    t1: { customFields: { 'veld-huisstijl': { optieGids: ['opt-opnieuw'], datum: null, tekst: null } } },
  }, { aanvragen: [] })
  const res = await handler(await signed([veldGewijzigd('t1')]))
  assertMatch(JSON.stringify(await res.json()), /geen aanvraag bij deze taak/)
  assertEquals(asana.gezet, [], 'niets gestart, dus ook niet op Bezig zetten')
})

// ── De deadline-mijlpaal ─────────────────────────────────────────────────────

const metDeadline = (datum: string | null) => ({ 'veld-deadline': { optieGids: [], datum, tekst: null } })

Deno.test('een wijziging zet de mijlpaal op de deadline uit Asana', async () => {
  const { handler, asana } = setup({ t1: { customFields: metDeadline('2026-11-20') } }, { mijlpalen: { t1: 'm1' } })
  await handler(await signed([dueChanged('t1')]))
  assertEquals(asana.mijlpalen, [['m1', { dueOn: '2026-11-20', completed: false }]])
})

Deno.test('een afgeronde taak rondt de mijlpaal af, een heropende zet hem weer open', async () => {
  const taken: Record<string, Partial<AsanaTask>> = { t1: { completed: true, customFields: metDeadline('2026-11-20') } }
  const { handler, asana } = setup(taken, { mijlpalen: { t1: 'm1' } })
  await handler(await signed([dueChanged('t1')]))
  taken.t1 = { completed: false, customFields: metDeadline('2026-11-27') }
  await handler(await signed([dueChanged('t1')]))
  assertEquals(asana.mijlpalen, [
    ['m1', { dueOn: '2026-11-20', completed: true }],
    ['m1', { dueOn: '2026-11-27', completed: false }],
  ])
})

Deno.test('zonder mijlpaal of zonder deadline gebeurt er niets met mijlpalen', async () => {
  const zonder = setup({ t1: { customFields: metDeadline('2026-11-20') } }, { mijlpalen: {} })
  await zonder.handler(await signed([dueChanged('t1')]))
  assertEquals(zonder.asana.mijlpalen, [])
  const leeg = setup({ t1: { customFields: metDeadline(null) } }, { mijlpalen: { t1: 'm1' } })
  await leeg.handler(await signed([dueChanged('t1')]))
  assertEquals(leeg.asana.mijlpalen, [])
})

Deno.test('een weggegooide taak neemt zijn mijlpaal mee', async () => {
  const { handler, asana, vervallen } = setup({ t1: {} }, { mijlpalen: { t1: 'm1' } })
  await handler(await signed([verwijderd('t1')]))
  assertEquals(asana.verwijderd, ['m1'])
  assertEquals(vervallen.length, 1)
})

// ── De knop "Verstuur nu" (Oplevermail) ──────────────────────────────

const opleverKnop = (optie = 'opt-verstuur') => ({ customFields: { 'veld-oplever': { optieGids: [optie], datum: null, tekst: null } } })

Deno.test('Verstuur nu zet het veld op Bezig en start de oplevering', async () => {
  const opgeleverd: string[] = []
  const { handler, asana } = setup({ t1: opleverKnop() }, {
    oplever: (t) => (opgeleverd.push(t.gid), Promise.resolve('verstuurd')),
  })
  const res = await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(res.status, 200)
  assertEquals(opgeleverd, ['t1'])
  assertEquals(asana.gezet[0], ['t1', { 'veld-oplever': 'opt-op-bezig' }])
})

Deno.test('de oplevering loopt na het antwoord aan Asana door', async () => {
  // Bestanden downloaden en mailen duurt langer dan Asana op een webhook wacht.
  const lopend: Promise<unknown>[] = []
  let klaar = false
  const { handler } = setup({ t1: opleverKnop() }, {
    oplever: async () => {
      await new Promise((r) => setTimeout(r, 5))
      klaar = true
      return 'verstuurd'
    },
    achtergrond: (werk) => lopend.push(werk),
  })
  const res = await handler(await signed([veldGewijzigd('t1')]))
  assertMatch(JSON.stringify(await res.json()), /oplevermail gestart/)
  assertEquals(klaar, false, 'het antwoord wacht niet op de mail')
  await Promise.all(lopend)
  assertEquals(klaar, true)
})

Deno.test('Bezig, Proef verstuurd, Verstuurd en Mislukt starten niets', async () => {
  for (const optie of ['opt-op-bezig', 'opt-proef-verstuurd', 'opt-verstuurd', 'opt-op-mislukt']) {
    const opgeleverd: string[] = []
    const { handler } = setup({ t1: opleverKnop(optie) }, { oplever: (t) => (opgeleverd.push(t.gid), Promise.resolve('x')) })
    await handler(await signed([veldGewijzigd('t1')]))
    assertEquals(opgeleverd, [], `${optie} hoort niets te starten`)
  }
})

Deno.test('een afgeronde taak kan opnieuw worden opgeleverd', async () => {
  // Na feedback komt er een versie 2; de taak kan dan al in Klaar staan.
  const opgeleverd: string[] = []
  const { handler } = setup({ t1: { completed: true, ...opleverKnop() } }, {
    oplever: (t) => (opgeleverd.push(t.gid), Promise.resolve('verstuurd')),
  })
  await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(opgeleverd, ['t1'])
})

Deno.test('een fout in de oplevering laat de webhook niet omvallen', async () => {
  const { handler } = setup({ t1: opleverKnop() }, { oplever: () => Promise.reject(new Error('stuk')) })
  const res = await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(res.status, 200)
})

Deno.test('Stuur proef naar mij geeft door wie drukte', async () => {
  const gevraagd: unknown[] = []
  const { handler, asana } = setup({ t1: opleverKnop('opt-proef') }, {
    oplever: (t, opties) => (gevraagd.push([t.gid, opties]), Promise.resolve('proefmail verstuurd')),
  })
  await handler(await signed([{ ...veldGewijzigd('t1'), user: { gid: 'devi', resource_type: 'user' } }]))
  assertEquals(gevraagd, [['t1', { proef: true, door: 'devi' }]])
  assertEquals(asana.gezet[0], ['t1', { 'veld-oplever': 'opt-op-bezig' }])
})

Deno.test('Verstuur nu is geen proef', async () => {
  const gevraagd: unknown[] = []
  const { handler } = setup({ t1: opleverKnop() }, { oplever: (_t, opties) => (gevraagd.push(opties), Promise.resolve('x')) })
  await handler(await signed([veldGewijzigd('t1')]))
  assertEquals(gevraagd, [{ proef: false, door: null }])
})

// ── Kolom en vinkje ───────────────────────────────────────────────────

const naarKolom = (gid: string, sectie: string) => ({ action: 'added', resource: { gid, resource_type: 'task' }, parent: { gid: sectie, resource_type: 'section' } })
const deadline = (datum: string) => ({ 'veld-deadline': { optieGids: [], datum, tekst: null } })

Deno.test('naar Klaar gesleept: de taak wordt afgevinkt, en de deadline-mijlpaal ook', async () => {
  const { handler, asana } = setup({
    t1: { completed: false, memberships: [{ project: 'proj1', section: 'sec-klaar' }], customFields: deadline('2026-11-13') },
  }, { mijlpalen: { t1: 'mijl1' } })
  await handler(await signed([naarKolom('t1', 'sec-klaar')]))
  assertEquals(asana.vinkjes, [['t1', true]])
  assertEquals(asana.mijlpalen, [['mijl1', { dueOn: '2026-11-13', completed: true }]])
})

Deno.test('uit Klaar gesleept: het vinkje gaat eraf, en de mijlpaal gaat weer open', async () => {
  const { handler, asana } = setup({
    t1: { completed: true, memberships: [{ project: 'proj1', section: 'sec-plan' }], customFields: deadline('2026-11-13') },
  }, { mijlpalen: { t1: 'mijl1' } })
  await handler(await signed([naarKolom('t1', 'sec-plan')]))
  assertEquals(asana.vinkjes, [['t1', false]])
  assertEquals(asana.mijlpalen, [['mijl1', { dueOn: '2026-11-13', completed: false }]])
})

Deno.test('al afgevinkt in Klaar, of open in een andere kolom: niets te doen', async () => {
  const { handler, asana } = setup({
    a: { completed: true, memberships: [{ project: 'proj1', section: 'sec-klaar' }] },
    b: { completed: false, memberships: [{ project: 'proj1', section: 'sec-nieuw' }] },
  })
  await handler(await signed([naarKolom('a', 'sec-klaar'), naarKolom('b', 'sec-nieuw')]))
  assertEquals(asana.vinkjes, [])
})

Deno.test('zelf het vinkje zetten in een andere kolom wordt niet teruggedraaid', async () => {
  // Alleen slepen telt; een gewone wijziging aan een afgevinkte taak buiten Klaar laten we staan.
  const { handler, asana } = setup({ t1: { completed: true, memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  await handler(await signed([dueChanged('t1')]))
  assertEquals(asana.vinkjes, [])
})

Deno.test('een sleepbeurt die alweer achterhaald is, telt niet', async () => {
  // Asana meldt "naar Klaar", maar de taak staat inmiddels alweer in In planning.
  const { handler, asana } = setup({ t1: { completed: false, memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  await handler(await signed([naarKolom('t1', 'sec-klaar')]))
  assertEquals(asana.vinkjes, [])
})

Deno.test('naar een kolom van een ander project gesleept: niets', async () => {
  const { handler, asana } = setup({ t1: { completed: false, memberships: [{ project: 'proj1', section: 'sec-plan' }] } })
  await handler(await signed([naarKolom('t1', 'werkplanning-week-44')]))
  assertEquals(asana.vinkjes, [])
})
