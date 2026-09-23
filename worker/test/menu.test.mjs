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
import { leesMenuTekst, kiesPakket } from '../menu/menu-tekst.mjs'
import { menuIsBruikbaar } from '../lib/notes.mjs'
import { renderMenu, laadBasis, pakketten, inhoudVanBasis, pakketkenmerken } from '../menu/render.mjs'

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
            // De omschrijving onder een gerecht is een rij ingredienten of een
            // opsomming met bullets; allebei horen bij dat gerecht.
            const omschrijving = kolom.alineas[gerecht.ingrAlinea]
            assert.ok(['ingr', 'opsomming'].includes(omschrijving.soort),
              `onverwachte soort ${omschrijving.soort} onder een gerecht`)
            if (omschrijving.soort === 'opsomming') {
              assert.ok(Array.isArray(omschrijving.onderdelen) && omschrijving.onderdelen.length,
                'een opsomming zonder onderdelen is nergens aan aan te passen')
            }
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

test('de engine meet in het echte font, niet in een vervanger', { timeout: 120_000 }, async () => {
  // Als de fonts niet expliciet geladen worden voordat er gemeten wordt, meet
  // canvas measureText stilletjes in een vervangend font - dat scheelde 20% in
  // breedte. Gevolg: regels breken verkeerd af en tekst kan ongemerkt over een
  // blob lopen. Deze test dwingt de engine de regelval zelf uit te rekenen en
  // eist dat hij op dezelfde regels uitkomt als het basisontwerp.
  for (const pakket of ['diner-4gangen', 'lunch-basic', 'buffet']) {
    const { meldingen } = await renderMenu({ pakket, forceerHerberekening: true })
    assert.deepEqual(meldingen.regelval, [],
      `${pakket}: de opnieuw berekende regelval wijkt af van het basisontwerp`)
    assert.deepEqual(meldingen.structuur, [], `${pakket}: ${meldingen.structuur.join(' ')}`)
  }
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

test('een opsomming met bullets is een structuur, geen losse regels', () => {
  // "Tartelettes" in Grab & Go staat als opsomming in het ontwerp. Die moet als
  // onderdelen in de data staan, anders is er niets aan te veranderen.
  const basis = laadBasis('grab-and-go')
  const opsommingen = basis.kolommen
    .flatMap((k) => k.alineas)
    .filter((a) => a.soort === 'opsomming')
  assert.equal(opsommingen.length, 1, 'de opsomming van Grab & Go is niet herkend')
  const onderdelen = opsommingen[0].onderdelen
  assert.equal(onderdelen.length, 2)
  assert.equal(onderdelen[0].naam, 'Rundertartaar')
  assert.deepEqual(onderdelen[0].toelichting, ['umamicrème', 'kwartelei'])

  // Elk pakket kent de maten van een opsomming, ook de pakketten die er zelf geen
  // hebben: een gerecht met bullets kan naar een ander pakket verhuizen.
  for (const pakket of alle) {
    const stijl = laadBasis(pakket).opsommingStijl
    assert.ok(stijl && stijl.bullet && stijl.naam && stijl.toelichting,
      `${pakket} heeft geen opsomming-maten`)
    assert.ok(stijl.naarBullet > stijl.naarToelichting,
      `${pakket}: de sprong naar een nieuwe bullet hoort groter te zijn dan die naar een toelichting`)
  }
})

test('er kan een onderdeel bij een opsomming', { timeout: 120_000 }, async () => {
  const inhoud = inhoudVanBasis(laadBasis('grab-and-go'))
  const tartelettes = inhoud.secties[0].gerechten[0]
  assert.ok(Array.isArray(tartelettes.onderdelen), 'Tartelettes komt niet als opsomming terug')
  tartelettes.onderdelen.push({ naam: 'Gerookte paling', toelichting: ['appel', 'mierikswortelcreme'] })

  const { meldingen } = await renderMenu(inhoud)
  assert.deepEqual(meldingen.botsingen, [], 'de langere opsomming raakt een blob')
  assert.deepEqual(meldingen.overloop, [])
  // De alinea wordt langer, en dat hoort gemeld te worden.
  assert.equal(meldingen.regelval.length, 1)
  assert.match(meldingen.regelval[0], /6 regels/)
})

test('een opsomming kan naar een pakket dat er zelf geen heeft', { timeout: 120_000 }, async () => {
  const inhoud = inhoudVanBasis(laadBasis('diner-4gangen'))
  inhoud.secties[0].gerechten[1] = {
    naam: 'Tartelettes',
    onderdelen: [
      { naam: 'Rundertartaar', toelichting: ['umamicrème', 'kwartelei'] },
      { naam: 'Tallegio (vega)', toelichting: ['romige tallegio (kaasvulling)', 'kruidencrunch'] },
    ],
  }
  const { meldingen } = await renderMenu(inhoud)
  assert.deepEqual(meldingen.botsingen, [])
  assert.deepEqual(meldingen.overloop, [])
  assert.equal(meldingen.opmaak.length, 1, 'de wissel van ingredienten naar bullets hoort gemeld')
  assert.match(meldingen.opmaak[0], /opsomming met bullets/)
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

// ── De menu-invulling lezen ──────────────────────────────────────────
// De collega plakt het menu zoals hij het van de opdrachtgever krijgt. Die tekst
// moet betrouwbaar om te zetten zijn, en het juiste basisontwerp moet erbij
// gezocht worden zonder dat iemand het pakket erbij hoeft te noemen.

const ECHTE_INVULLING = `Invulling menu:
Op tafel

• Bruschetta-spiezen met seasonal dips

Voorgerecht

• Gerookte hoenderfilet | gel van basilicum en appel | gepofte boekweit | mustard cress
Tussengerecht

• Aka-uo Tatsuta (gefrituurde roodbaars) | zoetzure komkommer | rode peper | rode ui | misosaus

Hoofdgerecht

• Langzaam gegaarde kalfsrollade | parmezaanse roomsaus | citroen | groene peper

Nagerecht

• dessertbuffet – verschillende zoete lekkernijen`

test('de aangeleverde menu-invulling wordt goed gelezen', () => {
  const { secties, opmerkingen } = leesMenuTekst(ECHTE_INVULLING)
  assert.deepEqual(opmerkingen, [])
  assert.deepEqual(secties.map((s) => s.kop),
    ['Op tafel', 'Voorgerecht', 'Tussengerecht', 'Hoofdgerecht', 'Nagerecht'])

  // "Invulling menu:" hoort bij de mail, niet bij het menu.
  assert.ok(!secties.some((s) => /invulling/i.test(s.kop)))

  // Voor de streep staat de naam, erachter de ingredienten.
  const voorgerecht = secties[1].gerechten[0]
  assert.equal(voorgerecht.naam, 'Gerookte hoenderfilet')
  assert.deepEqual(voorgerecht.ingredienten,
    ['gel van basilicum en appel', 'gepofte boekweit', 'mustard cress'])

  // Een gerecht zonder streep heeft alleen een naam.
  assert.equal(secties[0].gerechten[0].naam, 'Bruschetta-spiezen met seasonal dips')
  assert.equal(secties[0].gerechten[0].ingredienten, undefined)
})

test('het basisontwerp wordt aan de kopjes herkend', () => {
  const { secties } = leesMenuTekst(ECHTE_INVULLING)
  const keuze = kiesPakket(secties, pakketkenmerken())
  assert.equal(keuze.pakket, 'diner-4gangen')
  assert.equal(keuze.score, 1)

  // Zonder Tussengerecht is het een driegangen.
  const zonder = secties.filter((s) => s.kop !== 'Tussengerecht')
  assert.equal(kiesPakket(zonder, pakketkenmerken()).pakket, 'diner-3gangen')
})

test('kopjes die nergens bij passen leveren geen pakket op', () => {
  const { secties } = leesMenuTekst('Hapjes\n\n• Iets\n\nBorrel\n\n• Iets anders')
  const keuze = kiesPakket(secties, pakketkenmerken())
  assert.equal(keuze.pakket, null)
  assert.match(keuze.uitleg, /geen enkel basisontwerp/)
})

test('een opsomming met bullets komt als onderdelen terug', () => {
  // Zo staat "Tartelettes" in Grab & Go: een gerecht met onderdelen eronder.
  const { secties } = leesMenuTekst(`Op de tafel staat het volgende klaar:

• Tartelettes
  - Rundertartaar | umamicreme | kwartelei
  - Tallegio (vega) | romige tallegio | kruidencrunch

• Pao de Queijo | Braziliaanse kaasballetjes`)
  const gerechten = secties[0].gerechten
  assert.equal(gerechten.length, 2)
  assert.equal(gerechten[0].naam, 'Tartelettes')
  assert.equal(gerechten[0].onderdelen.length, 2)
  assert.equal(gerechten[0].onderdelen[0].naam, 'Rundertartaar')
  assert.deepEqual(gerechten[0].onderdelen[0].toelichting, ['umamicreme', 'kwartelei'])
  // Het gerecht ernaast blijft een gewoon gerecht met ingredienten.
  assert.deepEqual(gerechten[1].ingredienten, ['Braziliaanse kaasballetjes'])
})

test('gerechten uit het ontwerp die niet zijn aangeleverd verdwijnen', { timeout: 120_000 }, async () => {
  // Het basisontwerp van het viergangen diner heeft twee gerechten op tafel. Levert
  // de opdrachtgever er maar een, dan mag het tweede niet blijven staan: dat zou een
  // gerecht op het scherm zetten dat niemand besteld heeft.
  const inhoud = inhoudVanBasis(laadBasis('diner-4gangen'))
  inhoud.secties[0].gerechten = [inhoud.secties[0].gerechten[0]]
  const { meldingen } = await renderMenu(inhoud)
  assert.equal(meldingen.structuur.length, 1)
  assert.match(meldingen.structuur[0], /2 gerechten in het basisontwerp, 1 in de aangeleverde/)
})

test('tekst die de dieetwens-regel raakt maakt het scherm onbruikbaar', { timeout: 120_000 }, async () => {
  // De voetregel staat niet in de achtergrond, dus de blob-controle ziet hem niet.
  // Juist daar loopt een kolom tegenaan zodra de gerechten langer worden. Zo'n scherm
  // mag niet als resultaat de deur uit - melden alleen is niet genoeg.
  const inhoud = inhoudVanBasis(laadBasis('diner-4gangen'))
  inhoud.secties[3].gerechten[0].ingredienten =
    Array.from({ length: 12 }, (_, i) => `een vrij lang ingredient nummer ${i}`)
  const { meldingen } = await renderMenu(inhoud)
  const raakt = meldingen.botsingen.find((b) => b.waar === 'de dieetwens-regel')
  assert.ok(raakt, `verwachtte een botsing met de voetregel, kreeg ${JSON.stringify(meldingen.botsingen)}`)
  assert.equal(menuIsBruikbaar(meldingen), false, 'zo n scherm hoort niet goedgekeurd te worden')
  // De melding moet zeggen welke gang te lang is, anders kun je er niets mee.
  assert.equal(raakt.sectie, 'Hoofdgerecht')
  assert.ok(raakt.gerecht, 'de melding noemt geen gerecht')
})

test('een basisontwerp levert altijd een bruikbaar scherm', { timeout: 300_000 }, async () => {
  for (const pakket of alle) {
    const { meldingen } = await renderMenu({ pakket })
    assert.equal(menuIsBruikbaar(meldingen), true,
      `${pakket}: ${JSON.stringify(meldingen.botsingen)} ${JSON.stringify(meldingen.overloop)}`)
  }
})
