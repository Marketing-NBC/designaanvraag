/**
 * summarizeFonts() moet twee dingen uit elkaar houden: hoe prominent een familie is
 * (weight_score, de hoeveelheid tekst) en welk CSS-gewicht die familie heeft. Toen die twee
 * op één hoop gingen werden gewichten als strings aan elkaar geplakt ("0" + "400" + "700"),
 * wat zowel onzinnige gewichten opleverde als de verkeerde familie per rol.
 *
 *   node --test --experimental-strip-types worker/test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeFonts } from '../lib/signals.mjs'

/** Zoals browser.mjs het aanlevert: weight is de CSS-string, weight_score de tekstlengte. */
const meting = (role, family, weight, weight_score) => ({ role, family, weight: String(weight), size: '16px', weight_score })

test('gewichten zijn echte CSS-gewichten, geen aaneengeplakte getallen', () => {
  const fonts = summarizeFonts({
    loaded: [],
    computed: [meting('h2', 'RijksText', 700, 120), meting('h2', 'RijksText', 700, 90), meting('h2', 'RijksText', 700, 60)],
  })
  const [h2] = fonts.by_role.h2
  assert.equal(h2.weight, 700)
  assert.deepEqual(h2.weights, [700])
})

test('bij meerdere gewichten wint het meest gebruikte, de rest blijft zichtbaar', () => {
  const fonts = summarizeFonts({
    loaded: [],
    computed: [meting('body', 'Open Sans', 400, 500), meting('body', 'Open Sans', 600, 40), meting('body', 'Open Sans', 700, 10)],
  })
  const [body] = fonts.by_role.body
  assert.equal(body.weight, 400, 'het dominante gewicht is 400')
  assert.deepEqual(body.weights, [400, 600, 700], 'oplopend, zodat er "400/600/700" van te maken is')
})

test('de prominentste familie wint, niet de familie die het vaakst voorkomt', () => {
  // Alpha: één keer, maar veel tekst. Beta: drie keer, nauwelijks tekst.
  // Met de oude string-optelling werd Beta "0400400400" en won die onterecht van Alpha "0400".
  const fonts = summarizeFonts({
    loaded: [],
    computed: [
      meting('body', 'Alpha', 400, 400),
      meting('body', 'Beta', 400, 1),
      meting('body', 'Beta', 400, 1),
      meting('body', 'Beta', 400, 1),
    ],
  })
  assert.equal(fonts.by_role.body[0].family, 'Alpha')
  assert.equal(fonts.by_role.body[1].family, 'Beta')
})

test('een rol zonder bruikbaar gewicht levert null op, geen NaN', () => {
  const fonts = summarizeFonts({ loaded: [], computed: [meting('nav', 'Alpha', 'normal', 20)] })
  assert.equal(fonts.by_role.nav[0].weight, null)
  assert.deepEqual(fonts.by_role.nav[0].weights, [])
})

test('generieke en geladen fonts worden herkend', () => {
  const fonts = summarizeFonts({
    loaded: [{ family: 'Montserrat', weight: '800', style: 'normal' }],
    computed: [meting('h1', 'Montserrat', 800, 50), meting('body', 'Arial', 400, 50)],
  })
  assert.equal(fonts.by_role.h1[0].generic, false)
  assert.equal(fonts.by_role.h1[0].loaded, true)
  assert.equal(fonts.by_role.body[0].generic, true)
  assert.equal(fonts.by_role.body[0].loaded, false)
})

test('zonder metingen blijft by_role leeg (fallback-pad)', () => {
  const fonts = summarizeFonts({ loaded: [], computed: [], google: ['Montserrat'], adobe: false, fontFace: [] })
  assert.deepEqual(fonts.by_role, {})
  assert.deepEqual(fonts.google_fonts, ['Montserrat'])
})
