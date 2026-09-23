import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { chromiumExecutable, REPO_DIR, WORKER_DIR, parseArgs, log } from '../lib/config.mjs'

const MENU_DIR = join(WORKER_DIR, 'menu')
const BASIS_DIR = join(MENU_DIR, 'basis')
const FONT_DIR = join(REPO_DIR, 'web', 'src', 'assets', 'fonts')

/** Welk fontbestand hoort bij welke naam uit het basisontwerp. */
const FONTBESTANDEN = {
  'Pockota-Light': 'Pockota-Light.otf',
  'Pockota-Regular': 'Pockota-Regular.otf',
  'Pockota-Medium': 'Pockota-Medium.otf',
  'AreaNormal-Hairline': 'AreaNormal-Hairline.otf',
  'AreaNormal-HairlineItalic': 'AreaNormal-HairlineItalic.otf',
  'AreaNormal-Regular': 'AreaNormal-Regular.otf',
  'AreaNormal-Semibold': 'AreaNormal-Semibold.otf',
  'AreaNormal-ExtraBold': 'AreaNormal-Extrabold.otf',
}

/**
 * Bewuste afwijking van het Illustrator-bestand.
 *
 * De basisontwerpen zetten de ingredienten in AreaNormal-Thin, maar NBC gebruikt
 * daarvoor Hairline. Die keuze staat hier, op een plek, in plaats van dat de
 * renderer stilletjes op iets anders terugvalt als een font ontbreekt.
 *
 * Gevolg: de tekst is iets lichter dan in het .ai-bestand. Elk woord staat nog
 * op precies dezelfde plek - de regelval van de basisontwerpen ligt vast en
 * wordt niet opnieuw berekend. Alleen als een gerecht wijzigt breekt de engine
 * die ene alinea zelf af, en dan gebeurt dat in Hairline-breedtes. Dat toetst
 * controle.mjs met de kolom "bij herberekening".
 */
const VERVANGINGEN = {
  'AreaNormal-Thin': 'AreaNormal-Hairline',
}

const fontVoor = (naam) => VERVANGINGEN[naam] || naam

/** Bestanden in basis/ die geen pakket zijn maar wel .json heten. */
const GEEN_PAKKET = new Set(['gerechten'])

/** De pakketten waarvoor een bevroren basisontwerp klaarstaat. */
export function pakketten() {
  if (!existsSync(BASIS_DIR)) return []
  return readdirSync(BASIS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -5))
    .filter((n) => !GEEN_PAKKET.has(n))
    .sort()
}

/**
 * De gerechtenbibliotheek: hoe elke tekst uit de basisontwerpen op het scherm
 * hoort te staan, inclusief de plek waar de regel afbreekt. Zie
 * gerechtenbibliotheek() in basis-extract.py.
 */
export function laadBibliotheek() {
  const pad = join(BASIS_DIR, 'gerechten.json')
  return existsSync(pad) ? JSON.parse(readFileSync(pad, 'utf8')) : {}
}

export function laadBasis(pakket) {
  const pad = join(BASIS_DIR, `${pakket}.json`)
  if (!existsSync(pad)) {
    throw new Error(`Onbekend pakket "${pakket}". Draai eerst worker/menu/basis-extract.py.`)
  }
  return JSON.parse(readFileSync(pad, 'utf8'))
}

/**
 * De inhoud van een basisontwerp in het formaat dat renderMenu verwacht.
 * Handig als startpunt: je kopieert dit, vervangt de gerechten die de
 * opdrachtgever anders wil, en laat de rest staan.
 */
export function inhoudVanBasis(basis) {
  const secties = []
  for (const kolom of basis.kolommen) {
    for (const sectie of kolom.secties) {
      const uit = { kop: sectie.kopAlinea == null ? null : kolom.alineas[sectie.kopAlinea].tekst, gerechten: [] }
      for (const gerecht of sectie.gerechten) {
        const omschrijving = gerecht.ingrAlinea == null ? null : kolom.alineas[gerecht.ingrAlinea]
        const naam = kolom.alineas[gerecht.naamAlinea].tekst
        if (omschrijving && omschrijving.soort === 'opsomming') {
          // Een opsomming met bullets, zoals "Tartelettes": per onderdeel een naam
          // en een toelichting. Zo kun je er een onderdeel bij zetten of hem naar
          // een ander pakket verplaatsen.
          uit.gerechten.push({ naam, onderdelen: omschrijving.onderdelen })
        } else if (omschrijving) {
          uit.gerechten.push({
            naam,
            ingredienten: omschrijving.tekst.split('|').map((s) => s.trim()).filter(Boolean),
          })
        } else {
          uit.gerechten.push({ naam })
        }
      }
      secties.push(uit)
    }
  }
  return { pakket: basis.pakket, titel: basis.titel.tekst, secties }
}

/**
 * Per pakket de kopjes en het aantal gerechten, om te bepalen welk basisontwerp
 * bij een aangeleverd menu hoort. Zie kiesPakket in menu-tekst.mjs.
 */
export function pakketkenmerken() {
  return pakketten().map((pakket) => {
    const basis = laadBasis(pakket)
    const koppen = []
    let gerechten = 0
    for (const kolom of basis.kolommen) {
      for (const sectie of kolom.secties) {
        if (sectie.kopAlinea != null) koppen.push(kolom.alineas[sectie.kopAlinea].tekst)
        gerechten += sectie.gerechten.length
      }
    }
    return { pakket, koppen, gerechten }
  })
}

function dataUri(pad, type) {
  return `data:${type};base64,${readFileSync(pad).toString('base64')}`
}

/**
 * Zet voor elk gebruikt font een @font-face met het bestand als data-URI in de
 * pagina; about:blank mag geen file:// laden. Alleen de fonts die het ontwerp
 * echt gebruikt, zodat een familie nooit gedeclareerd kan staan zonder bestand.
 */
function fontsInvoegen(html, families) {
  const regels = []
  for (const familie of families) {
    const bestand = FONTBESTANDEN[familie]
    const pad = bestand && join(FONT_DIR, bestand)
    if (!pad || !existsSync(pad)) {
      throw new Error(`Fontbestand voor ${familie} ontbreekt in ${FONT_DIR}.`)
    }
    regels.push(`  @font-face { font-family: '${familie}'; `
      + `src: url('${dataUri(pad, 'font/otf')}') format('opentype'); }`)
  }
  return html.replace('{{FONTS}}', regels.join('\n'))
}

/**
 * Draait de bewuste correcties op het .ai terug: de gecorrigeerde titel en de
 * woorden die we anders spellen dan de bron. Alleen voor de pixelvergelijking in
 * controle.mjs; zo blijft die meten wat de opmaak doet en niet wat wij verbeteren.
 */
function zetTerugNaarBron(payload) {
  const basis = payload.basis
  if (basis.titel.bronTekst) basis.titel.tekst = basis.titel.bronTekst

  const woorden = basis.correcties?.woorden ?? []
  if (!woorden.length) return
  const terug = (t) => woorden.reduce(
    (tekst, [fout, goed]) => tekst.replace(new RegExp(`\\b${goed}\\b`, 'g'), fout), String(t))

  for (const kolom of basis.kolommen) {
    for (const alinea of kolom.alineas) {
      alinea.tekst = terug(alinea.tekst)
      for (const regel of alinea.regels) for (const run of regel.runs) run.tekst = terug(run.tekst)
    }
  }
  for (const gerecht of Object.values(payload.bibliotheek?.gerechten ?? {})) {
    gerecht.naam = terug(gerecht.naam)
    gerecht.ingredienten = gerecht.ingredienten.map(terug)
    for (const regel of [...gerecht.naamRegels, ...(gerecht.ingrRegels ?? [])]) {
      regel.tekst = terug(regel.tekst)
    }
  }
  for (const alinea of Object.values(payload.bibliotheek?.alineas ?? {})) {
    alinea.tekst = terug(alinea.tekst)
    for (const regel of alinea.regels) regel.tekst = terug(regel.tekst)
  }
}

/**
 * De vergelijkingsregels uit gerecht-match.mjs, als gewoon script het sjabloon in.
 *
 * Het sjabloon draait in de browser en kan niets importeren, maar deze regels
 * moeten daar precies hetzelfde werken als in de tests hier. Daarom staan ze op
 * een plek, en wordt alleen het `export`-woord eruit gehaald zodat de functies
 * als globals beschikbaar komen.
 */
function matchScript() {
  const bron = readFileSync(join(MENU_DIR, 'gerecht-match.mjs'), 'utf8')
  return `<script>\n${bron.replace(/^export /gm, '')}\n</script>`
}

/** Past de bewuste fontvervangingen toe op een bevroren basisontwerp. */
function vervangFonts(basis) {
  const kopie = structuredClone(basis)
  const zet = (o) => { if (o && o.font) o.font = fontVoor(o.font) }
  zet(kopie.titel)
  if (kopie.logobalk) zet(kopie.logobalk.plaatshouder)
  for (const regel of kopie.voetregel?.regels || []) zet(regel)
  for (const soort of Object.values(kopie.stijl || {})) zet(soort)
  for (const kolom of kopie.kolommen) {
    for (const alinea of kolom.alineas) {
      for (const regel of alinea.regels) for (const run of regel.runs) zet(run)
    }
  }
  return kopie
}

/**
 * De fonts die dit basisontwerp gebruikt, en meteen de controle dat de renderer
 * ze allemaal kent. Zonder die controle zou een onbekende fontnaam stil terug-
 * vallen op een standaardfont: de tekst staat er dan wel, maar in andere
 * breedtes en dus met een andere regelval dan het basisontwerp.
 */
function gebruikteFonts(basis) {
  const gebruikt = new Set()
  const verzamel = (o) => { if (o && o.font) gebruikt.add(o.font) }
  verzamel(basis.titel)
  if (basis.logobalk) verzamel(basis.logobalk.plaatshouder)
  for (const r of basis.voetregel?.regels || []) verzamel(r)
  for (const kolom of basis.kolommen) {
    for (const alinea of kolom.alineas) {
      for (const regel of alinea.regels) for (const run of regel.runs) verzamel(run)
    }
  }
  const onbekend = [...gebruikt].filter((f) => !(f in FONTBESTANDEN))
  if (onbekend.length) {
    throw new Error(`Basisontwerp "${basis.pakket}" gebruikt fonts die de renderer niet kent: `
      + `${onbekend.join(', ')}. Vul ze aan in FONTBESTANDEN in worker/menu/render.mjs.`)
  }
  return [...gebruikt].sort()
}

/**
 * Rendert een menuscherm op 3840x2160 uit een bevroren basisontwerp.
 *
 * @param {object} opdracht
 *   pakket   naam van het basisontwerp, bv. 'diner-4gangen'
 *   titel    optioneel: andere titel dan die van het basisontwerp
 *   merk     optioneel: { logo, logoAchtergrond, accent, blobBoven, blobOnder }
 *   secties  optioneel: [{ kop, gerechten: [{ naam, ingredienten: [] }] }]
 *            Laat je dit weg, dan wordt het basisontwerp zelf gerenderd.
 *   forceerHerberekening  alleen voor controle.mjs; zie payload hieronder
 * @returns {Promise<{png: Buffer, meldingen: object, fonts: string[]}>}
 */
export async function renderMenu(opdracht) {
  const basis = vervangFonts(laadBasis(opdracht.pakket))
  const families = gebruikteFonts(basis)
  const achtergrond = dataUri(join(BASIS_DIR, basis.achtergrond), 'image/png')
  const icoonSvg = readFileSync(join(BASIS_DIR, 'bestek-icoon.svg'), 'utf8')
  const icoon = icoonSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

  let html = fontsInvoegen(readFileSync(join(MENU_DIR, 'template.html'), 'utf8'), families)

  const payload = {
    basis,
    bibliotheek: laadBibliotheek(),
    achtergrond,
    inhoud: { titel: opdracht.titel, secties: opdracht.secties },
    merk: opdracht.merk || {},
    // Voor controle.mjs: dwingt de engine om elke alinea zelf opnieuw af te
    // breken in plaats van de regelval van het basisontwerp over te nemen.
    forceerHerberekening: Boolean(opdracht.forceerHerberekening),
  }
  // Voor controle.mjs: zet terug wat we bewust anders zetten dan het .ai, zodat de
  // pixelvergelijking niet over onze eigen correcties struikelt (zie CORRECTIES en
  // WOORDCORRECTIES in basis-extract.py).
  if (opdracht.zoalsBron) zetTerugNaarBron(payload)
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  html = html.replace('<script>', '<script>'
    + `window.__MENU__ = ${json};`
    + `window.__ICOON__ = ${JSON.stringify(icoon)};`
    + '</script>\n' + matchScript() + '\n<script>')

  const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    const meldingen = await page.evaluate(() => window.__KLAAR__)
    // De opmaak zoals de engine hem gelegd heeft: welke gang in welke kolom, en
    // elke regel met zijn baseline. Daar kan een test op toetsen.
    const opmaak = await page.evaluate(() => window.__OPMAAK__ ?? null)
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 3840, height: 2160 } })
    return { png, meldingen, opmaak, fonts: families }
  } finally {
    await browser.close()
  }
}

// CLI:
//   node worker/menu/render.mjs --pakketten
//   node worker/menu/render.mjs --pakket diner-4gangen --sjabloon > menu.json
//   node worker/menu/render.mjs --data menu.json --out scherm.png
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs()
  if (args.pakketten) {
    for (const p of pakketten()) console.log(p)
    process.exit(0)
  }
  const opdracht = args.data ? JSON.parse(readFileSync(args.data, 'utf8')) : {}
  if (args.pakket) opdracht.pakket = args.pakket
  if (!opdracht.pakket) {
    console.error('Geef een pakket op: --pakket diner-4gangen (of --pakketten voor de lijst)')
    process.exit(1)
  }
  if (args.sjabloon) {
    console.log(JSON.stringify(inhoudVanBasis(laadBasis(opdracht.pakket)), null, 2))
    process.exit(0)
  }
  const uit = args.out || join(MENU_DIR, 'out.png')
  log(`Menuscherm renderen: ${opdracht.pakket}`)
  const { png, meldingen } = await renderMenu(opdracht)
  writeFileSync(uit, png)
  for (const soort of ['structuur', 'regelval', 'botsingen', 'overloop']) {
    for (const m of meldingen[soort] || []) log(`${soort}: ${typeof m === 'string' ? m : JSON.stringify(m)}`)
  }
  log(`Klaar -> ${uit} (${(png.length / 1024).toFixed(0)} KB)`)
}
