import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { chromiumExecutable, REPO_DIR, WORKER_DIR, parseArgs, log } from '../lib/config.mjs'

const MENU_DIR = join(WORKER_DIR, 'menu')
const BASIS_DIR = join(MENU_DIR, 'basis')
const FONT_DIR = join(REPO_DIR, 'web', 'src', 'assets', 'fonts')

/**
 * De fonts die de basisontwerpen gebruiken, met de bestanden die erbij horen.
 * AreaNormal-Thin staat nog niet in de repo; zolang dat zo is valt hij terug op
 * Hairline. De breedtes schelen minder dan 1%, dus de regelval blijft gelijk,
 * maar de tekst oogt dan iets lichter dan in het .ai-bestand.
 */
const FONTS = {
  'Pockota-Medium': ['Pockota-Medium.otf'],
  'AreaNormal-ExtraBold': ['AreaNormal-Extrabold.otf'],
  'AreaNormal-Thin': ['AreaNormal-Thin.otf', 'AreaNormal-Hairline.otf'],
  'AreaNormal-HairlineItalic': ['AreaNormal-HairlineItalic.otf'],
  'AreaNormal-Regular': ['AreaNormal-Regular.otf'],
  'AreaNormal-Semibold': ['AreaNormal-Semibold.otf'],
}

/** De pakketten waarvoor een bevroren basisontwerp klaarstaat. */
export function pakketten() {
  if (!existsSync(BASIS_DIR)) return []
  return readdirSync(BASIS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -5))
    .sort()
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
        const ingr = gerecht.ingrAlinea == null ? null : kolom.alineas[gerecht.ingrAlinea].tekst
        uit.gerechten.push({
          naam: kolom.alineas[gerecht.naamAlinea].tekst,
          ...(ingr ? { ingredienten: ingr.split('|').map((s) => s.trim()).filter(Boolean) } : {}),
        })
      }
      secties.push(uit)
    }
  }
  return { pakket: basis.pakket, titel: basis.titel.tekst, secties }
}

function dataUri(pad, type) {
  return `data:${type};base64,${readFileSync(pad).toString('base64')}`
}

function fontsInvoegen(html) {
  const ontbreekt = []
  for (const [familie, kandidaten] of Object.entries(FONTS)) {
    const bestand = kandidaten.find((n) => existsSync(join(FONT_DIR, n)))
    if (!bestand) {
      ontbreekt.push(familie)
      continue
    }
    if (bestand !== kandidaten[0]) ontbreekt.push(`${familie} (valt terug op ${bestand})`)
    const uri = dataUri(join(FONT_DIR, bestand), 'font/otf')
    html = html.split(`{{FONT}}/${kandidaten[0]}`).join(uri)
  }
  // Wat er niet is, laten we als lege bron staan; de browser slaat die dan over.
  html = html.replace(/url\('\{\{FONT\}\}\/[^']*'\)/g, "url('')")
  return { html, ontbreekt }
}

/**
 * Rendert een menuscherm op 3840x2160 uit een bevroren basisontwerp.
 *
 * @param {object} opdracht
 *   pakket   naam van het basisontwerp, bv. 'diner-4gangen'
 *   titel    optioneel: andere titel dan die van het basisontwerp
 *   merk     optioneel: { logo, logoAchtergrond, accent }
 *   secties  optioneel: [{ kop, gerechten: [{ naam, ingredienten: [] }] }]
 *            Laat je dit weg, dan wordt het basisontwerp zelf gerenderd.
 * @returns {Promise<{png: Buffer, meldingen: object, ontbrekendeFonts: string[]}>}
 */
/**
 * Controleert dat elk font dat het basisontwerp gebruikt ook echt geladen wordt.
 * Zonder deze controle valt een onbekende fontnaam stil terug op een standaard-
 * font: de tekst staat er dan wel, maar in andere breedtes en dus met een andere
 * regelval dan het basisontwerp.
 */
function controleerFonts(basis) {
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
  const onbekend = [...gebruikt].filter((f) => !(f in FONTS))
  if (onbekend.length) {
    throw new Error(`Basisontwerp "${basis.pakket}" gebruikt fonts die de renderer niet kent: `
      + `${onbekend.join(', ')}. Vul ze aan in FONTS in worker/menu/render.mjs.`)
  }
}

export async function renderMenu(opdracht) {
  const basis = laadBasis(opdracht.pakket)
  controleerFonts(basis)
  const achtergrond = dataUri(join(BASIS_DIR, basis.achtergrond), 'image/png')
  const icoonSvg = readFileSync(join(BASIS_DIR, 'bestek-icoon.svg'), 'utf8')
  const icoon = icoonSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

  let html = readFileSync(join(MENU_DIR, 'template.html'), 'utf8')
  const { html: metFonts, ontbreekt } = fontsInvoegen(html)
  html = metFonts

  const payload = {
    basis,
    achtergrond,
    inhoud: { titel: opdracht.titel, secties: opdracht.secties },
    merk: opdracht.merk || {},
  }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  html = html.replace('<script>', '<script>'
    + `window.__MENU__ = ${json};`
    + `window.__ICOON__ = ${JSON.stringify(icoon)};`
    + '</script>\n<script>')

  const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    const meldingen = await page.evaluate(() => window.__KLAAR__)
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 3840, height: 2160 } })
    return { png, meldingen, ontbrekendeFonts: ontbreekt }
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
  const { png, meldingen, ontbrekendeFonts } = await renderMenu(opdracht)
  writeFileSync(uit, png)
  for (const f of ontbrekendeFonts) log(`Let op: font ${f}`)
  for (const soort of ['structuur', 'regelval', 'botsingen', 'overloop']) {
    for (const m of meldingen[soort] || []) log(`${soort}: ${typeof m === 'string' ? m : JSON.stringify(m)}`)
  }
  log(`Klaar -> ${uit} (${(png.length / 1024).toFixed(0)} KB)`)
}
