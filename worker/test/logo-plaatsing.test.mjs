/**
 * Waar het logo van de opdrachtgever komt te staan.
 *
 * De maatvoering komt uit het referentiebestand waarin Abel zeven logo's met de hand
 * plaatste. Daaruit kwam geen vaste hoogte of breedte, maar wel: de kortste zijde ligt
 * steeds rond de 330. Een breed logo is een band en wordt begrensd door zijn hoogte,
 * een rond logo is een blok en wordt begrensd door zijn breedte; bij een gelijke korte
 * zijde wegen ze optisch even zwaar.
 *
 * Wat hier getoetst wordt is niet of het mooi is - dat beoordeelt de ontwerper - maar
 * of het logo doet wat is afgesproken: groot genoeg, nooit over de tekst, nooit in de
 * blob, en nooit stilletjes kleiner door iets wat er niet onder staat.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {
  BLOB_MARGE, BOVEN_MARGE, KORTE_ZIJDE, ONDER_GRENS, TEKST_MARGE,
  plaatsLogo, scherptewaarschuwing,
} from '../menu/logo-plaatsing.mjs'
import { logoBeeld } from '../menu/logo.mjs'

/** Een ontwerp zoals lunch-basic: twee kolommen links, blob op 3088, tekst vanaf 546. */
const RUIMTE = {
  blobRand: 3088,
  eersteTekst: 546,
  kolommen: [{ x0: 261, x1: 1046, boven: 546 }, { x0: 1425, x1: 2276, boven: 546 }],
}

test('de kortste zijde bepaalt de grootte, ongeacht de vorm', () => {
  // Een breed, een vierkant en een rond logo horen er even zwaar uit te komen.
  for (const [naam, breedte, hoogte] of [['breed', 3188, 1296], ['vierkant', 1000, 1000],
                                         ['rond', 1660, 1660]]) {
    const p = plaatsLogo({ breedte, hoogte }, RUIMTE)
    assert.ok(Math.abs(Math.min(p.breedte, p.hoogte) - KORTE_ZIJDE) < 1,
      `${naam}: kortste zijde is ${Math.round(Math.min(p.breedte, p.hoogte))}, verwacht ${KORTE_ZIJDE}`)
    assert.ok(Math.abs(p.breedte / p.hoogte - breedte / hoogte) < 0.01, `${naam}: de verhouding mag niet schuiven`)
  }
})

test('het logo staat rechts, op een vaste afstand van de blob', () => {
  for (const [breedte, hoogte] of [[3188, 1296], [1000, 1000], [600, 1500]]) {
    const p = plaatsLogo({ breedte, hoogte }, RUIMTE)
    assert.equal(Math.round(p.x + p.breedte), RUIMTE.blobRand - BLOB_MARGE)
  }
})

test('tekst die eronder staat duwt het logo omhoog', () => {
  // Een kolom die tot onder het logo doorloopt: dan moet het logo wijken.
  const metKolom = { ...RUIMTE, kolommen: [...RUIMTE.kolommen, { x0: 2600, x1: 3000, boven: 546 }] }
  const p = plaatsLogo({ breedte: 1660, hoogte: 1967 }, metKolom)
  assert.ok(p.y + p.hoogte <= 546 - TEKST_MARGE + 1,
    `het logo loopt tot ${Math.round(p.y + p.hoogte)} en de tekst begint op 546`)
  assert.equal(p.krap, true, 'dat het niet op maat paste hoort gemeld te kunnen worden')
})

test('tekst die er niet onder staat knijpt het logo niet af', () => {
  // Dit ging eerst mis: de hoogste tekstregel van het hele scherm telde mee, ook als
  // die in de linker kolom stond en het logo rechtsboven. Het logo werd daar kleiner
  // van zonder dat er iets in de weg stond.
  const rond = plaatsLogo({ breedte: 1660, hoogte: 1660 }, RUIMTE)
  assert.ok(Math.abs(Math.min(rond.breedte, rond.hoogte) - KORTE_ZIJDE) < 1)
  assert.ok(rond.y + rond.hoogte > RUIMTE.eersteTekst - TEKST_MARGE,
    'er is ruimte onder de eerste tekstregel, want daar staat rechts niets')
  assert.ok(rond.y + rond.hoogte <= ONDER_GRENS + 1, 'maar niet tot halverwege het scherm')
})

test('een staand logo wordt begrensd door de hoogte, niet door de korte zijde', () => {
  const p = plaatsLogo({ breedte: 600, hoogte: 3000 }, RUIMTE)
  assert.equal(p.krap, true)
  assert.ok(p.y >= BOVEN_MARGE - 1, 'blijft onder de bovenmarge')
  assert.ok(p.y + p.hoogte <= ONDER_GRENS + 1, 'en boven de ondergrens')
  assert.ok(Math.abs(p.breedte / p.hoogte - 0.2) < 0.01, 'de verhouding blijft staan')
})

test('het logo hangt in het midden van de ruimte die het heeft', () => {
  const p = plaatsLogo({ breedte: 1000, hoogte: 1000 }, RUIMTE)
  const ruimteOnder = ONDER_GRENS - (p.y + p.hoogte)
  const ruimteBoven = p.y - BOVEN_MARGE
  assert.ok(Math.abs(ruimteBoven - ruimteOnder) < 1,
    `boven ${Math.round(ruimteBoven)}, onder ${Math.round(ruimteOnder)}`)
})

test('een logo dat opgeblazen moet worden levert een waarschuwing op', () => {
  const plaatsing = { breedte: 800, hoogte: 330 }
  assert.equal(scherptewaarschuwing({ bron: { breedte: 1600 }, plaatsing }), null,
    'ruim genoeg: niets te melden')
  assert.equal(scherptewaarschuwing({ bron: { breedte: 300 }, plaatsing, vector: true }), null,
    'een SVG schaalt mee')
  const krap = scherptewaarschuwing({ bron: { breedte: 300 }, plaatsing })
  assert.match(krap, /fors/)
  assert.match(krap, /300 pixels/)
  assert.match(scherptewaarschuwing({ bron: { breedte: 600 }, plaatsing }), /iets/)
})

test('de marge rond een aangeleverd logo gaat eraf', async () => {
  // Wie een logo exporteert laat daar vaak witruimte in staan. Zonder bijsnijden telt
  // die marge mee als logo, en wordt het beeld kleiner naarmate iemand ruimer heeft
  // geexporteerd. Dat is een toevalligheid van het bestand, geen keuze.
  const merk = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#0a1f3d' } })
    .png().toBuffer()
  const metMarge = await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: merk, left: 200, top: 150 }]).png().toBuffer()

  const beeld = await logoBeeld({ name: 'logo.png', buffer: metMarge })
  assert.equal(beeld.breedte, 200, 'de marge telt niet meer mee')
  assert.equal(beeld.hoogte, 100)

  // En de plaatsing rekent dan met het logo zelf: kortste zijde op maat.
  const p = plaatsLogo(beeld, RUIMTE)
  assert.ok(Math.abs(p.hoogte - KORTE_ZIJDE) < 1)
})
