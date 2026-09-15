import { assertEquals, assertMatch } from 'jsr:@std/assert@1'
import type { AsanaFieldsConfig, AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import { ASK_DATE_MARKER, createHandler, hmacHex, type WebhookStore } from './handler.ts'

const TOKEN = 'tok123'
const RESOURCE = 'proj1'
const SECRET = 'geheim'

const cfg: AsanaFieldsConfig = {
  project: { gid: 'proj1', name: 'Designaanvragen' },
  assignee: { gid: 'abel' },
  fields: {},
  sections: {
    nieuwe_aanvragen: { gid: 'sec-nieuw' },
    in_planning: { gid: 'sec-plan' },
    mee_bezig: { gid: 'sec-bezig' },
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
    // De planning-flow raakt geen velden aan; dit is er om aan `AsanaTaskClient` te voldoen.
    updateCustomFields: () => Promise.resolve([]),
  }
  return { client, added, posted }
}

function setup(tasks: Record<string, Partial<AsanaTask>>, opts: { comments?: Record<string, string[]>; secrets?: string[] } = {}) {
  const store = fakeStore(opts.secrets)
  const asana = fakeAsana(tasks, opts.comments)
  const handler = createHandler({ token: TOKEN, store, asana: asana.client, cfg, log: () => {} })
  return { handler, store, asana }
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

Deno.test('datum in Nieuwe aanvragen of Klaar → niets; Mee bezig → wel inplannen', async () => {
  const { handler, asana } = setup({
    nieuw: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-nieuw' }] },
    klaar: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-klaar' }] },
    bezig: { dueOn: '2026-10-20', memberships: [{ project: 'proj1', section: 'sec-bezig' }] },
    ander: { dueOn: '2026-10-20', memberships: [{ project: 'proj9', section: 'x' }] },
  })
  const res = await handler(await signed([dueChanged('nieuw'), dueChanged('klaar'), dueChanged('bezig'), dueChanged('ander')]))
  const body = await res.json()
  assertEquals(body.handled.nieuw, 'datum, maar niet in planning of mee bezig')
  assertEquals(body.handled.klaar, 'datum, maar niet in planning of mee bezig')
  assertEquals(body.handled.bezig, 'ingepland')
  assertEquals(body.handled.ander, 'niet in ons project')
  assertEquals(asana.added, [['bezig', 'werk1']])
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
