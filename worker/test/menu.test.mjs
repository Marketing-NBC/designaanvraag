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
import { renderMenu, laadBasis, laadBibliotheek, pakketten, inhoudVanBasis, pakketkenmerken } from '../menu/render.mjs'
import { zoekGerecht } from '../menu/gerecht-match.mjs'

/** Zelfde normalisatie als tekstsleutel() in basis-extract.py en template.html. */
const sleutelVan = (t) => String(t)
  .replace(/[\u2018\u2019\u00b4\u0060]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .toLowerCase()
  .replace(/\s*\|\s*/g, ' | ')
  .replace(/\s+/g, ' ')
  .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
  .trim()

/** Zelfde normalisatie als gerechtsleutel(): waar de streep staat telt niet mee. */
const gerechtSleutelVan = (t) => sleutelVan(t).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()

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

// ── De gerechtenbibliotheek ──────────────────────────────────────────
// NBC werkt met een vast repertoire. Staat een gerecht in een basisontwerp, dan
// is dat de manier waarop het gezet hoort te worden - ook als het in een ander
// pakket opduikt. Anders zou onze eigen afbreking bepalen waar de regel breekt,
// en dan ziet hetzelfde gerecht er per pakket anders uit.

test('elke tekst uit de basisontwerpen staat in de bibliotheek', () => {
  const { alineas } = laadBibliotheek()
  assert.ok(Object.keys(alineas).length > 50, 'de bibliotheek is verdacht leeg')

  for (const pakket of alle) {
    const basis = laadBasis(pakket)
    for (const kolom of basis.kolommen) {
      for (const alinea of kolom.alineas) {
        if (!['naam', 'ingr'].includes(alinea.soort)) continue
        const grootte = alinea.regels[0].runs[0].grootte
        const sleutel = `${alinea.soort}|${grootte}|${sleutelVan(alinea.tekst)}`
        assert.ok(alineas[sleutel],
          `${pakket}: "${alinea.tekst.slice(0, 40)}" staat niet in de bibliotheek`)
      }
    }
  }
})

test('elk gerecht uit de basisontwerpen staat als geheel in de bibliotheek', () => {
  const { gerechten } = laadBibliotheek()
  assert.ok(Object.keys(gerechten).length > 50, 'de bibliotheek is verdacht leeg')

  for (const pakket of alle) {
    const basis = laadBasis(pakket)
    for (const kolom of basis.kolommen) {
      for (const sectie of kolom.secties) {
        for (const gerecht of sectie.gerechten) {
          const naam = kolom.alineas[gerecht.naamAlinea]
          const omschrijving = gerecht.ingrAlinea == null ? null : kolom.alineas[gerecht.ingrAlinea]
          // Een opsomming met bullets is een eigen structuur en hoort er niet in.
          if (omschrijving && omschrijving.soort === 'opsomming') continue
          const geheel = omschrijving ? `${naam.tekst} | ${omschrijving.tekst}` : naam.tekst
          const grootte = naam.regels[0].runs[0].grootte
          assert.ok(gerechten[`${grootte}|${gerechtSleutelVan(geheel)}`],
            `${pakket}: "${geheel.slice(0, 50)}" staat niet in de bibliotheek`)
        }
      }
    }
  }
})

test('de bibliotheek bewaart de regelval van de ontwerper', () => {
  const { gerechten, alineas } = laadBibliotheek()

  // Het dessert van pagina 7: de naam breekt na "met", de omschrijving eronder
  // blijft op een regel. Dat is hoe Abel het gezet heeft.
  const dessert = gerechten["61.6|dessertbuffet met zoete lekkernijen l'or coffee popping pearls"]
  assert.ok(dessert, 'het dessert van pagina 7 staat niet in de bibliotheek')
  assert.equal(dessert.naam, 'Dessertbuffet met zoete lekkernijen')
  assert.deepEqual(dessert.naamRegels.map((r) => r.tekst), ['Dessertbuffet met', 'zoete lekkernijen'])
  assert.equal(dessert.ingrRegels.length, 1)

  // Dezelfde schotel met de streep op een andere plek is hetzelfde gerecht: de
  // bibliotheek zegt waar de naam ophoudt, niet degene die hem intypt.
  const anders = gerechten[
    `61.6|${gerechtSleutelVan("Dessertbuffet | met zoete lekkernijen | L'OR Coffee Popping Pearls")}`]
  assert.equal(anders, dessert)

  // En de losse alinea's blijven als vangnet bestaan.
  const pearls = alineas["ingr|41.8|l'or coffee popping pearls"]
  assert.ok(pearls, 'de omschrijving van pagina 7 staat niet in de bibliotheek')
  assert.equal(pearls.regels.length, 1)
})

test('een gerecht uit een ander pakket houdt zijn eigen regelval', { timeout: 120_000 }, async () => {
  // Het dessert komt uit het driegangen diner; in het viergangen diner is de
  // kolom net zo breed, dus het hoort er precies zo te staan.
  const inhoud = inhoudVanBasis(laadBasis('diner-4gangen'))
  const nagerecht = inhoud.secties[inhoud.secties.length - 1]
  nagerecht.gerechten = [{
    naam: 'Dessertbuffet met zoete lekkernijen',
    // met een rechte apostrof en in kleine letters: dat is zetwerk, geen andere inhoud
    ingredienten: ["l'or coffee popping pearls"],
  }]
  const { meldingen } = await renderMenu(inhoud)
  assert.deepEqual(meldingen.regelval, [],
    'de bibliotheek is niet gebruikt; de engine heeft zelf afgebroken')
  assert.deepEqual(meldingen.botsingen, [])
})

test('de streep mag ergens anders staan dan de ontwerper hem zette',
  { timeout: 120_000 }, async () => {
  // Abel schrijft "Dessertbuffet met zoete lekkernijen | L'OR Coffee Popping Pearls";
  // iemand anders typt hetzelfde gerecht als "Dessertbuffet | met zoete lekkernijen |
  // L'OR Coffee Popping Pearls". Dat is dezelfde schotel, en hij hoort er dan ook
  // precies hetzelfde uit te zien: de bibliotheek weet waar de naam ophoudt.
  const zoalsHetHoort = await renderMenu(inhoudVanBasis(laadBasis('diner-3gangen')))

  const inhoud = inhoudVanBasis(laadBasis('diner-3gangen'))
  const nagerecht = inhoud.secties[inhoud.secties.length - 1]
  nagerecht.gerechten = [{
    naam: 'Dessertbuffet',
    ingredienten: ['met zoete lekkernijen', "l'or coffee popping pearls"],
  }]
  const anders = await renderMenu(inhoud)

  assert.deepEqual(anders.meldingen.regelval, [],
    'de bibliotheek is niet gebruikt; de engine heeft zelf afgebroken')
  assert.deepEqual(anders.meldingen.botsingen, [])
  assert.ok(anders.png.equals(zoalsHetHoort.png),
    'het scherm ziet er anders uit dan wanneer de streep op de plek van de ontwerper staat')
})

// ── Een gerecht terugvinden dat anders is opgeschreven ──────────────
// Het repertoire ligt vast, maar de tekst komt binnen zoals de traiteur hem
// opschrijft. Zoeken op gelijkenis is hier levensgevaarlijk: wisselt NBC tonijn
// voor zalm, dan lijkt dat gerecht voor 90% op de versie uit het ontwerp en zou
// er tonijn op het scherm komen. Daarom telt dekking en niet gelijkenis.

test('een gerecht dat anders geformuleerd is wordt herkend', () => {
  const { gerechten } = laadBibliotheek()
  const zoek = (t) => zoekGerecht(t, gerechten, 61.6)

  // Zoals Abel het van de traiteur krijgt: andere woorden, geen streepjes.
  const anders = zoek("dessertbuffet – verschillende zoete lekkernijen met L'OR coffee popping pearls")
  assert.ok(anders, 'het dessert is niet herkend')
  assert.equal(anders.gerecht.naam, 'Dessertbuffet met zoete lekkernijen')
  assert.equal(anders.letterlijk, false)

  // Een tikfout mag, een andere volgorde ook.
  assert.equal(zoek("dessertbuffet met zoete lekkernije | L'OR coffee popping pearls")?.gerecht.naam,
    'Dessertbuffet met zoete lekkernijen')
  assert.equal(zoek("L'OR Coffee Popping Pearls | Dessertbuffet met zoete lekkernijen")?.gerecht.naam,
    'Dessertbuffet met zoete lekkernijen')

  // En letterlijk hetzelfde blijft gewoon letterlijk.
  assert.equal(zoek("Dessertbuffet met zoete lekkernijen | L'OR Coffee Popping Pearls")?.letterlijk, true)
})

test('een gewisseld product wordt nooit voor het origineel aangezien', () => {
  const { gerechten } = laadBibliotheek()
  // Alle drie lijken sterk op een gerecht uit een basisontwerp, maar er is een
  // product gewisseld. Dat is een ander gerecht, en het mag nooit stilzwijgend
  // als het origineel gezet worden - dan staat er tonijn waar zalm besteld is.
  const gewisseld = [
    ['tasteful gift zalmtartaar | mierikswortel | affilla cress | uiencrumble', 61.6],
    ['spinazieravioli | gedroogde italiaanse ham | saliebotersaus', 61.6],
    ['pompoenravioli | gedroogde spaanse ham | saliebotersaus', 61.6],
    ['burrata | tomatenmix | truffelolie', 56],
  ]
  for (const [tekst, grootte] of gewisseld) {
    assert.equal(zoekGerecht(tekst, gerechten, grootte), null,
      `"${tekst}" is ten onrechte aan een gerecht uit het ontwerp gekoppeld`)
  }
})

test('geen enkele verhaspeling levert het verkeerde gerecht op', () => {
  // De hele bibliotheek langs, met verhaspelingen die in de praktijk voorkomen.
  // Niet herkennen is prima - dan zet de engine hem zelf. Het verkeerde gerecht
  // herkennen is het enige wat echt niet mag.
  const { gerechten } = laadBibliotheek()
  let herkend = 0
  let gemist = 0
  for (const [sleutel, gerecht] of Object.entries(gerechten)) {
    const grootte = sleutel.slice(0, sleutel.indexOf('|'))
    const heel = [gerecht.naam, ...gerecht.ingredienten].join(' | ')
    const woorden = heel.split(' ')
    const langste = woorden.reduce((a, b) => (b.length > a.length ? b : a))
    const varianten = [
      heel.replace(' ', ' verschillende '),                        // een woord erbij
      heel.replace(langste, langste.slice(0, -1)),                 // een tikfout
      heel.toUpperCase(),                                          // andere kapitalen
      heel.replace(' | ', ' - '),                                  // ander scheidingsteken
    ]
    for (const v of varianten) {
      const r = zoekGerecht(v, gerechten, grootte)
      if (r === null) gemist += 1
      else if (r.sleutel === sleutel) herkend += 1
      else assert.fail(`"${v}" werd aangezien voor "${r.gerecht.naam}"`)
    }
  }
  assert.ok(herkend > gemist * 3, `te weinig herkend: ${herkend} herkend, ${gemist} gemist`)
})

test('een gerecht dat anders is opgeschreven komt zo op het scherm', { timeout: 120_000 }, async () => {
  // Het hele pad: iemand typt het dessert zoals de traiteur het stuurt, in een
  // adem, zonder streepje. Op het scherm hoort het te staan zoals Abel het zette
  // - naam op twee regels, de pearls op hun eigen regel eronder.
  const inhoud = inhoudVanBasis(laadBasis('diner-3gangen'))
  const nagerecht = inhoud.secties[inhoud.secties.length - 1]
  nagerecht.gerechten = [{ naam: "dessertbuffet – verschillende zoete lekkernijen met L'OR coffee popping pearls" }]
  const zoalsHetHoort = await renderMenu(inhoudVanBasis(laadBasis('diner-3gangen')))
  const anders = await renderMenu(inhoud)

  assert.ok(anders.png.equals(zoalsHetHoort.png),
    'het scherm wijkt af van het basisontwerp')
  // En het moet wel gemeld worden: er staat iets anders dan er is ingetypt.
  assert.equal(anders.meldingen.opmaak.length, 1)
  assert.match(anders.meldingen.opmaak[0], /is gezet zoals het in het basisontwerp staat/)
})

test('pagina 7 en 8 delen hun tekstkaders', () => {
  // Het is dezelfde layout, dus hetzelfde kader. Leidde je dat per pagina af uit
  // de inhoud die daar toevallig staat, dan werd kolom 3 te smal en brak een
  // omschrijving af die in het ontwerp op een regel past.
  const drie = laadBasis('diner-3gangen')
  const vier = laadBasis('diner-4gangen')
  assert.deepEqual(drie.kolommen.map((k) => k.x), vier.kolommen.map((k) => k.x))
  assert.equal(drie.kolommen[2].kader.breedte, vier.kolommen[2].kader.breedte)
  assert.ok(drie.kolommen[2].kader.gedeeldMet.includes('diner-4gangen'))
})
