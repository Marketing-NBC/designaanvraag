import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { SLEUTEL_HEADER, createTorenschermMaker, torenschermSleutel } from '../_shared/torenscherm.ts'
import type { Pixels } from '../_shared/shared/torenscherm-preview.ts'
import { createHandler } from './handler.ts'

const SLEUTEL = 'afgeleide-sleutel'
const FOTO: Pixels = { breedte: 2, hoogte: 2, data: new Uint8Array(16) }

function setup(opts: { foto?: 'fout'; maak?: 'fout' } = {}) {
  const gemaakt: number[] = []
  const handler = createHandler({
    sleutel: SLEUTEL,
    foto: () => opts.foto === 'fout' ? Promise.reject(new Error('404 bij nbc-torenscherm.jpg')) : Promise.resolve(FOTO),
    maak: (ontwerp) => {
      if (opts.maak === 'fout') throw new Error('Geen JPEG of PNG')
      gemaakt.push(ontwerp.length)
      return new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    },
    log: () => {},
  })
  const vraag = (o: { sleutel?: string | null; locatie?: string; body?: Uint8Array; method?: string } = {}) => {
    const headers = new Headers()
    if (o.sleutel !== null) headers.set(SLEUTEL_HEADER, o.sleutel ?? SLEUTEL)
    const url = `https://x.supabase.co/functions/v1/torenscherm-preview?locatie=${o.locatie ?? 'nbc'}`
    return handler(new Request(url, { method: o.method ?? 'POST', headers, body: o.method === 'GET' ? undefined : ((o.body ?? new Uint8Array([1, 2, 3])) as Uint8Array<ArrayBuffer>) }))
  }
  return { vraag, gemaakt }
}

Deno.test('zonder of met een verkeerde sleutel: geen toegang', async () => {
  const s = setup()
  assertEquals((await s.vraag({ sleutel: null })).status, 401)
  assertEquals((await s.vraag({ sleutel: 'fout' })).status, 401)
  assertEquals(s.gemaakt, [])
})

Deno.test('een design wordt een JPEG', async () => {
  const s = setup()
  const res = await s.vraag()
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('content-type'), 'image/jpeg')
  assertEquals(new Uint8Array(await res.arrayBuffer()), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
  assertEquals(s.gemaakt, [3])
})

Deno.test('zonder foto van de locatie, zonder design of met GET: een fout met reden', async () => {
  const s = setup()
  const gv = await s.vraag({ locatie: 'green_village' })
  assertEquals(gv.status, 400)
  assertStringIncludes((await gv.json()).error, 'green_village')
  assertEquals((await s.vraag({ body: new Uint8Array() })).status, 400)
  assertEquals((await s.vraag({ method: 'GET' })).status, 405)
})

Deno.test('lukt de foto of het rekenwerk niet, dan zegt het antwoord waarom', async () => {
  const foto = await setup({ foto: 'fout' }).vraag()
  assertEquals(foto.status, 502)
  assertStringIncludes((await foto.json()).error, '404 bij nbc-torenscherm.jpg')
  const maak = await setup({ maak: 'fout' }).vraag()
  assertEquals(maak.status, 422)
  assertEquals((await maak.json()).error, 'Geen JPEG of PNG')
})

Deno.test('de maker stuurt de afgeleide sleutel, niet de secret key zelf, en geeft de reden van een fout door', async () => {
  const calls: Request[] = []
  const antwoord = { res: new Response(new Uint8Array([0xff, 0xd8, 9]), { status: 200 }) }
  const maker = createTorenschermMaker('https://p.supabase.co', 'sb_secret_abc', (input, init) => {
    calls.push(new Request(input, init))
    return Promise.resolve(antwoord.res)
  })
  assertEquals(await maker.maak(new Uint8Array([1]), 'nbc'), new Uint8Array([0xff, 0xd8, 9]))
  assertEquals(calls[0].url, 'https://p.supabase.co/functions/v1/torenscherm-preview?locatie=nbc')
  assertEquals(calls[0].headers.get(SLEUTEL_HEADER), await torenschermSleutel('sb_secret_abc'))
  assertEquals([...calls[0].headers.values()].some((v) => v.includes('sb_secret_abc')), false)

  antwoord.res = Response.json({ error: 'De JPEG is niet te lezen' }, { status: 422 })
  let reden = ''
  await maker.maak(new Uint8Array([1]), 'nbc').catch((e) => (reden = e.message))
  assertEquals(reden, 'De JPEG is niet te lezen')
  antwoord.res = new Response('', { status: 546 })
  await maker.maak(new Uint8Array([1]), 'nbc').catch((e) => (reden = e.message))
  assertEquals(reden, 'het rekenwerk duurde te lang')
})
