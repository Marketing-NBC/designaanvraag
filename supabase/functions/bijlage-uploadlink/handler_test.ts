import { assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import type { NewBijlage } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import type { Storage } from '../_shared/storage.ts'
import { MAX_BIJLAGEN, MAX_BIJLAGE_BYTES } from '../_shared/shared/bijlagen.ts'
import { UPLOAD_LIMIET_PER_UUR, createHandler, type Deps } from './handler.ts'

const env: Env = {
  supabaseUrl: 'http://sb',
  supabaseSecretKey: 'x',
  allowedOrigins: ['https://marketing-nbc.github.io'],
  rateSalt: 'salt',
  rateLimitIpPerHour: 10,
  rateLimitGlobalPerDay: 100,
  asanaPat: null,
  asanaProjectGid: null,
  asanaAssigneeGid: null,
  asanaPlanningProjectGid: null,
  routineFireUrl: null,
  routineToken: null,
}

const GROEP = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function fake(over: Partial<Deps> = {}) {
  const bewaard: NewBijlage[] = []
  const paden: string[] = []
  const tellers = new Map<string, number>()
  let n = 0
  const storage: Storage = {
    uploadlink: (pad) => (paden.push(pad), Promise.resolve(`https://sb/storage/v1/object/upload/sign/aanvraag-bijlagen/${pad}?token=jwt`)),
    download: () => Promise.resolve(null),
  }
  const deps: Deps = {
    env,
    storage,
    insertBijlagen: async (rows) => void bewaard.push(...rows),
    async bumpRateLimit(key) {
      const k = (tellers.get(key) ?? 0) + 1
      tellers.set(key, k)
      return k
    },
    nieuwId: () => `id-${++n}`,
    log: () => {},
    ...over,
  }
  return { deps, bewaard, paden, tellers }
}

function post(body: unknown, ip = '10.0.0.1'): Request {
  return new Request('https://fn/bijlage-uploadlink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

const bestand = (over: Record<string, unknown> = {}) => ({ naam: 'logo.png', type: 'image/png', grootte: 12_345, ...over })
const payload = (bestanden: unknown[] = [bestand()]) => ({ doel: 'aanvraag', groep_id: GROEP, bestanden })

Deno.test('geeft per bestand een link terug en bewaart een rij', async () => {
  const { deps, bewaard, paden } = fake()
  const res = await createHandler(deps)(post(payload([bestand(), bestand({ naam: 'brief.pdf', type: 'application/pdf' })])))
  assertEquals(res.status, 200)
  const body = await res.json()

  assertEquals(body.links.length, 2)
  assertEquals(body.links[0].bestandsnaam, 'logo.png')
  assertStringIncludes(body.links[0].signed_url, 'token=')
  assertEquals(bewaard.length, 2)
  assertEquals(bewaard[0].bytes, 12_345)
  assertEquals(bewaard[0].mime, 'image/png')
  // Het pad staat in de map van de groep en houdt de extensie.
  assertEquals(paden, [`${GROEP}/id-1.png`, `${GROEP}/id-2.pdf`])
})

Deno.test('de bestandsnaam van de collega komt niet in het pad', async () => {
  const { deps, paden, bewaard } = fake()
  await createHandler(deps)(post(payload([bestand({ naam: '../../etc/geheim.png' })])))
  assertEquals(paden[0], `${GROEP}/id-1.png`)
  // Hij reist wel mee als naam van de bijlage, maar dan opgeschoond.
  assertEquals(bewaard[0].bestandsnaam, '..-..-etc-geheim.png')
})

Deno.test('weigert design-bronbestanden en wijst het bestand aan', async () => {
  const { deps, bewaard } = fake()
  const res = await createHandler(deps)(post(payload([bestand(), bestand({ naam: 'ontwerp.psd', type: 'image/vnd.adobe.photoshop' })])))
  assertEquals(res.status, 400)
  const body = await res.json()
  assertEquals(body.bestand, 1)
  assertMatch(body.error, /bestandstype/)
  // Niets bewaard: een halve batch levert rijen op waar nooit bytes bij komen.
  assertEquals(bewaard.length, 0)
})

Deno.test('weigert een bestand boven de grens', async () => {
  const { deps } = fake()
  const res = await createHandler(deps)(post(payload([bestand({ type: 'application/pdf', naam: 'groot.pdf', grootte: MAX_BIJLAGE_BYTES + 1 })])))
  assertEquals(res.status, 400)
})

Deno.test('weigert te veel bestanden en een te zware batch', async () => {
  const { deps } = fake()
  const handler = createHandler(deps)
  const teveel = await handler(post(payload(Array.from({ length: MAX_BIJLAGEN + 1 }, () => bestand()))))
  assertEquals(teveel.status, 400)

  const zwaar = await handler(
    post(payload(Array.from({ length: 3 }, (_, i) => bestand({ naam: `groot${i}.pdf`, type: 'application/pdf', grootte: 20 * 1024 * 1024 })))),
  )
  assertEquals(zwaar.status, 400)
  assertMatch((await zwaar.json()).error, /Samen maximaal/)
})

Deno.test('zegt bij een iPhone-foto wat er wél kan', async () => {
  const { deps } = fake()
  const res = await createHandler(deps)(post(payload([bestand({ naam: 'IMG_0421.HEIC', type: 'image/heic' })])))
  assertEquals(res.status, 400)
  assertMatch((await res.json()).error, /JPG/)
})

Deno.test('te veel uploads achter elkaar geeft 429', async () => {
  const { deps } = fake()
  const handler = createHandler(deps)
  for (let i = 0; i < UPLOAD_LIMIET_PER_UUR; i++) await handler(post(payload()))
  const res = await handler(post(payload()))
  assertEquals(res.status, 429)
  assertMatch((await res.json()).error, /over een uur/)
})

Deno.test('telt per IP, dus een andere collega heeft er geen last van', async () => {
  const { deps, tellers } = fake()
  const handler = createHandler(deps)
  await handler(post(payload(), '10.0.0.1'))
  await handler(post(payload(), '10.0.0.2'))
  const perIp = [...tellers.entries()].filter(([k]) => k.startsWith('upload:'))
  assertEquals(perIp.length, 2)
  assertEquals(perIp.map(([, n]) => n), [1, 1])
})

Deno.test('bewaart pas als alle links er zijn', async () => {
  const { deps, bewaard } = fake({
    storage: {
      uploadlink: (pad) => (pad.endsWith('.pdf') ? Promise.reject(new Error('Storage plat')) : Promise.resolve('https://sb/x')),
      download: () => Promise.resolve(null),
    },
  })
  const res = await createHandler(deps)(post(payload([bestand(), bestand({ naam: 'brief.pdf', type: 'application/pdf' })]))).catch((e) => e)
  assertEquals(res instanceof Error, true)
  assertEquals(bewaard.length, 0)
})

Deno.test('ongeldige JSON en een te grote body', async () => {
  const handler = createHandler(fake().deps)
  const stuk = new Request('https://fn', { method: 'POST', headers: { Origin: 'https://marketing-nbc.github.io' }, body: 'geen json' })
  assertEquals((await handler(stuk)).status, 400)

  const groot = new Request('https://fn', {
    method: 'POST',
    headers: { Origin: 'https://marketing-nbc.github.io' },
    body: JSON.stringify({ vulling: 'x'.repeat(9000) }),
  })
  assertEquals((await handler(groot)).status, 413)
})

Deno.test('OPTIONS en een verkeerde methode', async () => {
  const handler = createHandler(fake().deps)
  assertEquals((await handler(new Request('https://fn', { method: 'OPTIONS', headers: { Origin: 'https://marketing-nbc.github.io' } }))).status, 204)
  assertEquals((await handler(new Request('https://fn', { method: 'GET' }))).status, 405)
})
