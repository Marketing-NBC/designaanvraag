import { assertEquals } from 'jsr:@std/assert@1'
import type { Env } from '../_shared/env.ts'
import type { GevondenAanvraag } from '../_shared/shared/aanvulling-schema.ts'
import { createHandler, ZOEK_LIMIET_PER_UUR, type Deps } from './handler.ts'

const env: Env = {
  supabaseUrl: 'http://sb',
  supabaseSecretKey: 'x',
  allowedOrigins: ['https://marketing-nbc.github.io'],
  rateSalt: 'salt',
  rateLimitIpPerHour: 3,
  rateLimitGlobalPerDay: 5,
  asanaPat: null,
  asanaProjectGid: null,
  asanaAssigneeGid: null,
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

const treffer: GevondenAanvraag = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  soort: 'evenement',
  event: 'Zorgcongres 2026',
  event_datum: '2026-12-01',
  deadline: '2026-11-20',
  naam: 'Wendy Tester',
  aanvraag_types: ['led_kolom'],
  anders_tekst: '',
  schijf_locatie: '',
  omschrijving: '',
}

const interneTreffer: GevondenAanvraag = {
  ...treffer,
  id: '9b2504e0-4f89-41d3-9a0c-0305e82c3302',
  soort: 'intern',
  event: '',
  event_datum: null,
  aanvraag_types: [],
  omschrijving: 'Nieuwe visitekaartjes voor het salesteam',
}

function deps(over: Partial<Deps> = {}): Deps {
  const counters = new Map<string, number>()
  return {
    env,
    zoek: () => Promise.resolve([treffer]),
    zoekIntern: () => Promise.resolve([interneTreffer]),
    async bumpRateLimit(key) {
      const n = (counters.get(key) ?? 0) + 1
      counters.set(key, n)
      return n
    },
    log: () => {},
    ...over,
  }
}

function get(q: string): Request {
  return new Request(`https://fn/aanvraag-zoeken?q=${encodeURIComponent(q)}`, {
    headers: { Origin: 'https://marketing-nbc.github.io', 'x-forwarded-for': '10.0.0.1' },
  })
}

Deno.test('geeft treffers terug', async () => {
  const res = await createHandler(deps())(get('zorg'))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).resultaten, [treffer])
})

Deno.test('te kort is geen fout maar levert niets op', async () => {
  let geraadpleegd = 0
  const handler = createHandler(deps({ zoek: () => (geraadpleegd++, Promise.resolve([treffer])) }))
  for (const q of ['', 'z', 'zo', '  z  ']) {
    const res = await handler(get(q))
    assertEquals(res.status, 200)
    assertEquals((await res.json()).resultaten, [])
  }
  // En de database is er niet voor lastiggevallen.
  assertEquals(geraadpleegd, 0)
})

Deno.test('de zoekterm gaat ongeschonden door naar de database', async () => {
  const gezien: string[] = []
  await createHandler(deps({ zoek: (q) => (gezien.push(q), Promise.resolve([])) }))(get('  Zorgcongres 2026  '))
  assertEquals(gezien, ['Zorgcongres 2026'])
})

Deno.test('op naam zoekt alleen in de interne aanvragen', async () => {
  const gezien: string[] = []
  let opEvent = 0
  const handler = createHandler(deps({
    zoek: () => (opEvent++, Promise.resolve([treffer])),
    zoekIntern: (naam) => (gezien.push(naam), Promise.resolve([interneTreffer])),
  }))
  const res = await handler(new Request('https://fn/aanvraag-zoeken?naam=%20Wendy%20Tester%20', {
    headers: { Origin: 'https://marketing-nbc.github.io', 'x-forwarded-for': '10.0.0.1' },
  }))
  assertEquals((await res.json()).resultaten, [interneTreffer])
  assertEquals(gezien, ['Wendy Tester'])
  assertEquals(opEvent, 0)
})

Deno.test('een naam van één letter levert niets op', async () => {
  let geraadpleegd = 0
  const handler = createHandler(deps({ zoekIntern: () => (geraadpleegd++, Promise.resolve([interneTreffer])) }))
  const res = await handler(new Request('https://fn/aanvraag-zoeken?naam=W'))
  assertEquals((await res.json()).resultaten, [])
  assertEquals(geraadpleegd, 0)
})

Deno.test('te veel zoekopdrachten geeft 429', async () => {
  const handler = createHandler(deps())
  for (let i = 0; i < ZOEK_LIMIET_PER_UUR; i++) await handler(get('zorg'))
  assertEquals((await handler(get('zorg'))).status, 429)
})

Deno.test('OPTIONS en een verkeerde methode', async () => {
  const handler = createHandler(deps())
  const pre = await handler(new Request('https://fn', { method: 'OPTIONS', headers: { Origin: 'https://marketing-nbc.github.io' } }))
  assertEquals(pre.status, 204)
  assertEquals(pre.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS')
  assertEquals((await handler(new Request('https://fn', { method: 'POST' }))).status, 405)
})

// ── Op id: de knop "Feedback geven" in de opleveringsmail ─────────────

function opId(id: string): Request {
  return new Request(`https://fn/aanvraag-zoeken?id=${encodeURIComponent(id)}`, {
    headers: { Origin: 'https://marketing-nbc.github.io', 'x-forwarded-for': '10.0.0.1' },
  })
}

Deno.test('op id: precies die aanvraag', async () => {
  const gevraagd: string[] = []
  const res = await createHandler(deps({ zoekOpId: (id) => (gevraagd.push(id), Promise.resolve(treffer)) }))(opId(treffer.id.toUpperCase()))
  assertEquals((await res.json()).resultaten, [treffer])
  assertEquals(gevraagd, [treffer.id])
})

Deno.test('op id: niet gevonden of geen geldig id is een lege lijst', async () => {
  let gevraagd = 0
  const handler = createHandler(deps({ zoekOpId: () => (gevraagd++, Promise.resolve(null)) }))
  assertEquals((await (await handler(opId(treffer.id))).json()).resultaten, [])
  assertEquals((await (await handler(opId('1 or 1=1'))).json()).resultaten, [])
  assertEquals(gevraagd, 1, 'een onzin-id gaat niet naar de database')
})

Deno.test('op id telt mee voor de uurlimiet', async () => {
  const handler = createHandler(deps({ zoekOpId: () => Promise.resolve(treffer) }))
  for (let i = 0; i < ZOEK_LIMIET_PER_UUR; i++) await handler(opId(treffer.id))
  assertEquals((await handler(opId(treffer.id))).status, 429)
})
