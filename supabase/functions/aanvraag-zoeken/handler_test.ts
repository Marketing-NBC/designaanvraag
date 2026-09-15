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
}

const treffer: GevondenAanvraag = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  event: 'Zorgcongres 2026',
  event_datum: '2026-12-01',
  deadline: '2026-11-20',
  naam: 'Wendy Tester',
  aanvraag_types: ['led_kolom'],
  anders_tekst: '',
  schijf_locatie: '',
}

function deps(over: Partial<Deps> = {}): Deps {
  const counters = new Map<string, number>()
  return {
    env,
    zoek: () => Promise.resolve([treffer]),
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
