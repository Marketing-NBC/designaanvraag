/**
 * De menuschermen moeten er precies zo uitzien als het basisontwerp van het pakket.
 * Dat is geen kwestie van "lijkt erop": de opmaak-engine zet elk woord op de baseline
 * die in het Illustrator-bestand staat. Deze tests bewaken drie dingen:
 *
 *   1. de bevroren basisontwerpen zijn intern kloppend (fonts, secties, kaders)
 *   2. een basisontwerp dat door de engine gaat komt er 1:1 weer uit
 *   3. tekst die te lang wordt, valt nooit stilzwijgend over een blob
 *
 *   node --test --experimental-strip-types worker/test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { WORKER_DIR } from '../lib/config.mjs'
import { renderMenu, laadBasis, pakketten, inhoudVanBasis } from '../menu/render.mjs'

const BASIS_DIR = join(WORKER_DIR, 'menu', 'basis')

/** De fonts die render.mjs kan laden; alles daarbuiten zou stil terugvallen op een standaardfont. */
const BEKENDE_FONTS = new Set([
  'Pockota-Light', 'Pockota-Regular', 'Pockota-Medium',
  'AreaNormal-Hairline', 'AreaNormal-HairlineItalic', 'AreaNormal-Thin',
  'AreaNormal-Regular', 'AreaNormal-Semibold', 'AreaNormal-ExtraBold',
])

const alle = pakketten()

test('er staan bevroren basisontwerpen klaar', () => {
  assert.ok(alle.length > 0,
    'geen basisontwerpen gevonden - draai eerst: python3 worker/menu/basis-extract.py')
})

for (const pakket of alle) {
  test(`${pakket}: het basisontwerp is intern kloppend`, () => {
    const basis = laadBasis(pakket)

    assert.equal(basis.canvas.breedte, 3840)
    assert.equal(basis.canvas.hoogte, 2160)
    assert.ok(existsSync(join(BASIS_DIR, basis.achtergrond)),
      `achtergrond ${basis.achtergrond} ontbreekt`)

    for (const kolom of basis.kolommen) {
      // Het tekstkader moet breder zijn dan de langste regel, anders zou de engine
      // regels gaan afbreken die in het basisontwerp juist heel bleven.
      assert.ok(kolom.kader.breedte >= kolom.kader.minimaal,
        `kolom op x=${kolom.x}: kaderbreedte ${kolom.kader.breedte} is smaller dan de langste regel ${kolom.kader.minimaal}`)

      for (const alinea of kolom.alineas) {
        assert.ok(alinea.regels.length > 0, 'alinea zonder regels')
        for (const regel of alinea.regels) {
          assert.ok(regel.baseline > 0 && regel.baseline < 2160,
            `baseline ${regel.baseline} valt buiten het scherm`)
          for (const run of regel.runs) {
            assert.ok(BEKENDE_FONTS.has(run.font),
              `onbekend font ${run.font} - de renderer zou hier stil terugvallen op een standaardfont`)
          }
        }
      }

      // Elke sectie verwijst naar alinea's die echt bestaan.
      for (const sectie of kolom.secties) {
        if (sectie.kopAlinea != null) {
          assert.equal(kolom.alineas[sectie.kopAlinea].soort, 'kop')
        }
        for (const gerecht of sectie.gerechten) {
          assert.equal(kolom.alineas[gerecht.naamAlinea].soort, 'naam')
          if (gerecht.ingrAlinea != null) {
            assert.equal(kolom.alineas[gerecht.ingrAlinea].soort, 'ingr')
          }
        }
      }
    }
  })

  test(`${pakket}: de inhoud is rond te lezen en terug te schrijven`, () => {
    const basis = laadBasis(pakket)
    const inhoud = inhoudVanBasis(basis)
    const sectiesInBasis = basis.kolommen.reduce((n, k) => n + k.secties.length, 0)
    assert.equal(inhoud.secties.length, sectiesInBasis)
    assert.equal(inhoud.pakket, pakket)
    for (const sectie of inhoud.secties) {
      assert.ok(Array.isArray(sectie.gerechten))
    }
  })
}

test('een basisontwerp komt zonder waarschuwingen door de opmaak-engine', { timeout: 120_000 }, async () => {
  const { meldingen } = await renderMenu({ pakket: 'diner-4gangen' })
  assert.deepEqual(meldingen.botsingen, [], 'tekst raakt een blob')
  assert.deepEqual(meldingen.structuur, [], 'de opbouw wijkt af van het basisontwerp')
  assert.deepEqual(meldingen.overloop, [], 'tekst valt buiten het scherm')
})

test('de eigen inhoud van een basisontwerp verandert de regelval niet', { timeout: 120_000 }, async () => {
  // Wie het sjabloon ongewijzigd terugstuurt, hoort exact het basisontwerp te krijgen.
  const basis = laadBasis('lunch-standaard')
  const { meldingen } = await renderMenu(inhoudVanBasis(basis))
  assert.deepEqual(meldingen.regelval, [], 'de regelval wijkt af van het basisontwerp')
  assert.deepEqual(meldingen.botsingen, [])
})

test('tekst die over een blob zou vallen wordt gemeld', { timeout: 120_000 }, async () => {
  const basis = laadBasis('diner-4gangen')
  const inhoud = inhoudVanBasis(basis)
  // Kolom 1 volproppen; die grenst aan de blob linksonder.
  inhoud.secties[0].gerechten[1].ingredienten =
    Array.from({ length: 22 }, (_, i) => `zongedroogde tomaat ${i}`)
  const { meldingen } = await renderMenu(inhoud)
  assert.ok(meldingen.botsingen.length > 0,
    'te lange tekst raakt de blob maar dat werd niet gemeld')
  for (const botsing of meldingen.botsingen) {
    assert.ok(typeof botsing.baseline === 'number' && botsing.tekst,
      'een botsingsmelding moet zeggen welke regel waar botst')
  }
})

test('een onbekend pakket geeft een duidelijke fout', () => {
  assert.throws(() => laadBasis('bestaat-niet'), /Onbekend pakket/)
})

test('het voorbeeldmenu past bij een bestaand basisontwerp', () => {
  const pad = join(WORKER_DIR, 'menu', 'voorbeeld-diner-4gangen.json')
  const voorbeeld = JSON.parse(readFileSync(pad, 'utf8'))
  const basis = laadBasis(voorbeeld.pakket)
  const sectiesInBasis = basis.kolommen.reduce((n, k) => n + k.secties.length, 0)
  assert.equal(voorbeeld.secties.length, sectiesInBasis,
    'het voorbeeld heeft een ander aantal secties dan het basisontwerp')
})
