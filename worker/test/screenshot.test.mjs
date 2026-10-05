/**
 * De screenshots bij de huisstijl-extractie.
 *
 * Hier is één ding misgegaan dat we niet terug willen: compaxo.nl liep stuk op
 * `Input image exceeds pixel limit`. De paginascreenshot werd onbegrensd opgevraagd,
 * dus bij een pagina die tijdens het scrollen blijft groeien kwam er een buffer van
 * honderden megapixels uit de browser die sharp weigerde — en dat sleepte de hele
 * extractie mee, terwijl hero.png en header.png er al stonden.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PAGINA_MAX, paginaClip, screenshots } from '../lib/browser.mjs'

/** De standaardgrens van sharp: 0x3FFF × 0x3FFF pixels. */
const SHARP_STANDAARD = 268_402_689

/**
 * Een nepbrowser die onthoudt wat er gevraagd is. De buffer draagt zijn eigen
 * pixelaantal mee, zodat de nepsharp hieronder net zo kan weigeren als de echte.
 */
function nepPagina({ hoogte, breedte = 1440, schaal = 2, paginaFaalt = null }) {
  const gevraagd = []
  return {
    gevraagd,
    async evaluate() {
      return { breedte, hoogte }
    },
    async screenshot(opties = {}) {
      gevraagd.push(opties)
      if (opties.fullPage && paginaFaalt) throw new Error(paginaFaalt)
      const b = opties.clip?.width ?? breedte
      const h = opties.clip?.height ?? (opties.fullPage ? hoogte : 900)
      const buf = Buffer.alloc(8)
      buf.pixels = b * schaal * h * schaal
      return buf
    },
  }
}

/** Nepsharp die dezelfde grens aanhoudt als de echte, tenzij er een ruimere wordt meegegeven. */
function nepSharp(gelet) {
  return (buf, opties = {}) => {
    const grens = opties.limitInputPixels ?? SHARP_STANDAARD
    if ((buf.pixels ?? 0) > grens) throw new Error('Input image exceeds pixel limit')
    gelet.push({ pixels: buf.pixels, grens })
    const api = { resize: () => api, png: () => api, toFile: async () => {} }
    return api
  }
}

test('de paginascreenshot wordt nooit onbegrensd opgevraagd', async () => {
  const page = nepPagina({ hoogte: 11_320 }) // compaxo.nl, zoals gemeten
  const gelet = []
  const uit = await screenshots(page, '/niet-gebruikt', nepSharp(gelet))

  assert.equal(uit.page, 'page.png')
  assert.deepEqual(uit.waarschuwingen, [])
  const volledig = page.gevraagd.filter((o) => o.fullPage)
  assert.equal(volledig.length, 1)
  assert.ok(volledig[0].clip, 'de hele pagina opvragen zonder clip is precies wat misging')
  assert.equal(volledig[0].clip.height, PAGINA_MAX.hoogte)
})

test('een pagina die blijft groeien loopt niet meer stuk op de pixelgrens', async () => {
  // 268402689 / 2880 / 2 ≈ 46.600 CSS-pixels: daarboven weigerde sharp de buffer. Een pagina
  // met lazy loading kan daar tijdens het scrollen van de screenshot overheen schieten.
  const page = nepPagina({ hoogte: 60_000 })
  const gelet = []
  const uit = await screenshots(page, '/niet-gebruikt', nepSharp(gelet))

  assert.deepEqual(uit.waarschuwingen, [])
  assert.deepEqual([uit.hero, uit.header, uit.page], ['hero.png', 'header.png', 'page.png'])
  for (const beeld of gelet) assert.ok(beeld.pixels < SHARP_STANDAARD, `${beeld.pixels} pixels is te veel voor sharp`)
})

test('een korte pagina wordt niet opgerekt naar de maximale hoogte', async () => {
  const page = nepPagina({ hoogte: 1200 })
  await screenshots(page, '/niet-gebruikt', nepSharp([]))
  const volledig = page.gevraagd.find((o) => o.fullPage)
  assert.equal(volledig.clip.height, 1200, 'meer vragen dan er is, laat Playwright mislukken')
})

test('mislukt de paginascreenshot alsnog, dan blijven hero en header staan', async () => {
  const page = nepPagina({ hoogte: 9000, paginaFaalt: 'Clipped area is either empty or outside the resulting image' })
  const uit = await screenshots(page, '/niet-gebruikt', nepSharp([]))

  assert.equal(uit.hero, 'hero.png')
  assert.equal(uit.header, 'header.png')
  assert.equal(uit.page, undefined)
  assert.equal(uit.waarschuwingen.length, 1)
  assert.match(uit.waarschuwingen[0], /overzichtsscreenshot/)
})

test('sharp krijgt een ruimere pixelgrens mee dan zijn standaard', async () => {
  const gelet = []
  await screenshots(nepPagina({ hoogte: 3000 }), '/niet-gebruikt', nepSharp(gelet))
  assert.equal(gelet.length, 3)
  for (const beeld of gelet) assert.ok(beeld.grens > SHARP_STANDAARD, 'het vangnet hoort op elke sharp-aanroep te zitten')
})

test('de clip blijft binnen de pagina én binnen de grens', () => {
  assert.deepEqual(paginaClip({ breedte: 1440, hoogte: 11_320 }), { x: 0, y: 0, width: 1440, height: 4000 })
  assert.deepEqual(paginaClip({ breedte: 1440, hoogte: 900 }), { x: 0, y: 0, width: 1440, height: 900 })
  // Een pagina met horizontale overloop (een brede tabel, een slider) wordt ook afgeknipt.
  assert.deepEqual(paginaClip({ breedte: 30_000, hoogte: 500 }), { x: 0, y: 0, width: 2000, height: 500 })
  // En een onmeetbare pagina levert een geldige clip op, geen nul of NaN.
  assert.deepEqual(paginaClip({}), { x: 0, y: 0, width: 1, height: 1 })
})
