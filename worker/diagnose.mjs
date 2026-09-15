#!/usr/bin/env node
/**
 * Meet wat de omgeving van de Routine wél en niet kan bereiken. Draai dit als de extractie
 * onverklaarbaar mislukt: het laat per verzoek zien of het aankwam, en zo niet met welke fout.
 *
 *   node worker/diagnose.mjs [--url https://www.rijksmuseum.nl/]
 *
 * Geen Supabase of Asana nodig; dit raakt alleen het netwerk en de browser.
 */
import { chromium } from 'playwright'
import { chromiumExecutable, parseArgs } from './lib/config.mjs'

const args = parseArgs()
const url = args.url ?? 'https://www.rijksmuseum.nl/'

console.log('=== OMGEVING ===')
for (const naam of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'PLAYWRIGHT_BROWSERS_PATH', 'NODE_EXTRA_CA_CERTS']) {
  const v = process.env[naam]
  // Proxy-URL's kunnen inloggegevens bevatten, dus alleen host en poort tonen.
  let toon = 'niet gezet'
  if (v) {
    try {
      const u = new URL(v)
      toon = `${u.protocol}//${u.host}`
    } catch {
      toon = v.length > 60 ? `${v.slice(0, 60)}…` : v
    }
  }
  console.log(`  ${naam.padEnd(26)} ${toon}`)
}
console.log(`  Chromium                   ${chromiumExecutable() ?? 'meegeleverd door Playwright'}`)

console.log('\n=== GEWONE FETCH ===')
for (const doel of [url, 'https://www.google.com/', 'https://app.asana.com/api/1.0/users/me']) {
  try {
    const res = await fetch(doel, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    console.log(`  ${String(res.status).padEnd(4)} ${doel}`)
  } catch (e) {
    console.log(`  FOUT ${doel} — ${e.message}`)
  }
}

console.log('\n=== BROWSER ===')
const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || null
console.log(`  proxy meegegeven aan Chromium: ${proxyServer ? 'ja' : 'nee'}`)

const browser = await chromium.launch({
  executablePath: chromiumExecutable(),
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  proxy: proxyServer ? { server: proxyServer, bypass: process.env.NO_PROXY || 'localhost,127.0.0.1' } : undefined,
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'nl-NL', ignoreHTTPSErrors: true })
const page = await context.newPage()

const gelukt = new Map()
const mislukt = []
page.on('response', (r) => {
  const t = r.request().resourceType()
  gelukt.set(t, (gelukt.get(t) ?? 0) + 1)
})
page.on('requestfailed', (r) => {
  mislukt.push({ type: r.resourceType(), host: veiligeHost(r.url()), reden: r.failure()?.errorText ?? 'onbekend' })
})

function veiligeHost(u) {
  try {
    return new URL(u).host
  } catch {
    return u.slice(0, 40)
  }
}

let status = null
try {
  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 })
  status = res?.status() ?? null
} catch (e) {
  console.log(`  pagina laden mislukt: ${e.message}`)
}
console.log(`  HTTP-status hoofddocument: ${status ?? 'geen'}`)

if (status) {
  const meting = await page.evaluate(() => ({
    stylesheets: document.styleSheets.length,
    bodyAchtergrond: getComputedStyle(document.body).backgroundColor,
    bodyFont: getComputedStyle(document.body).fontFamily,
    linkKleur: (() => {
      const a = document.querySelector('a')
      return a ? getComputedStyle(a).color : 'geen link gevonden'
    })(),
    afbeeldingen: [...document.images].length,
    afbeeldingenGeladen: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length,
  }))
  console.log(`  stylesheets geladen:       ${meting.stylesheets}`)
  console.log(`  body achtergrond:          ${meting.bodyAchtergrond}`)
  console.log(`  body font:                 ${meting.bodyFont}`)
  console.log(`  kleur eerste link:         ${meting.linkKleur}`)
  console.log(`  afbeeldingen geladen:      ${meting.afbeeldingenGeladen} van ${meting.afbeeldingen}`)
  console.log('\n  Let op: stylesheets 0, font "Times New Roman" of linkkleur rgb(0, 0, 238) betekent dat')
  console.log('  de opmaak niet is binnengekomen, ook al gaf het hoofddocument een 200.')
}

console.log('\n  Gelukte verzoeken per soort:')
for (const [t, n] of [...gelukt.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)} ${t}`)

console.log(`\n  Mislukte verzoeken: ${mislukt.length}`)
const perReden = new Map()
for (const m of mislukt) {
  const sleutel = `${m.type} · ${m.reden}`
  perReden.set(sleutel, (perReden.get(sleutel) ?? 0) + 1)
}
for (const [sleutel, n] of [...perReden.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)} ${sleutel}`)
console.log('\n  Eerste tien mislukte verzoeken:')
for (const m of mislukt.slice(0, 10)) console.log(`    ${m.type.padEnd(12)} ${m.host.padEnd(35)} ${m.reden}`)

await browser.close()
console.log('\nKlaar. Plak deze uitvoer terug in het gesprek.')
