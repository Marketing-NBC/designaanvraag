#!/usr/bin/env node
/**
 * Stap 1 van de huisstijl-extractie: site laden, screenshots, logo's, kleuren en fonts verzamelen.
 *
 *   node worker/extract.mjs --aanvraag-id <uuid>      (leest de website uit Supabase, zet status 'running')
 *   node worker/extract.mjs --url https://site.nl     (los testen, geen Supabase nodig)
 *
 * Output in worker/out/<id>/: signals.json, meta.json, hero.png, header.png, page.png, logo-*.{svg,png}.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { collectLogoAssets, collectUrlAssets, screenshotPalette } from './lib/assets.mjs'
import { openSite, screenshots } from './lib/browser.mjs'
import { log, outDirFor, parseArgs, UUID_RE } from './lib/config.mjs'
import { fetchFallback } from './lib/fallback.mjs'
import { brandWordFromHost, scoreLogo, summarizeColors, summarizeFonts } from './lib/signals.mjs'

const args = parseArgs()
const started = Date.now()

let aanvraag = null
let url = args.url ?? null
if (args['aanvraag-id']) {
  if (!UUID_RE.test(args['aanvraag-id'])) {
    console.error('Ongeldig aanvraag-id (geen UUID).')
    process.exit(2)
  }
  const { getAanvraag, updateAanvraag } = await import('./lib/supabase.mjs')
  aanvraag = await getAanvraag(args['aanvraag-id'])
  url = aanvraag.website
  await updateAanvraag(aanvraag.id, { brand_status: 'running', brand_error: null })
}
if (!url) {
  console.error('Geef --aanvraag-id <uuid> of --url <website>.')
  process.exit(2)
}

const key = aanvraag?.id ?? new URL(url).hostname
const outDir = outDirFor(key)
const hostname = new URL(url).hostname
const brandWord = brandWordFromHost(hostname)
const warnings = []
log('start extractie', { url, outDir })

let site = null
let fallback = false
let shots = {}
let heroBuf = null
try {
  site = await openSite(url)
} catch (e) {
  warnings.push(`Browser kon de site niet laden (${e.message}); fallback via gewone fetch.`)
  log('browser mislukt', { error: e.message })
}

let dom, finalUrl, status
if (site) {
  dom = site.dom
  finalUrl = site.finalUrl
  status = site.status
  shots = await screenshots(site.page, outDir, sharp)
  heroBuf = shots.heroBuf
  delete shots.heroBuf
} else {
  fallback = true
  const fb = await fetchFallback(url)
  dom = fb.dom
  finalUrl = fb.finalUrl
  status = fb.status
}

// Logo-kandidaten scoren en de beste ophalen.
const scored = dom.logos.map((c) => ({ ...c, score: scoreLogo(c, brandWord) })).sort((a, b) => b.score - a.score)
const domAssets = await collectLogoAssets(site?.page ?? null, scored, outDir, { max: 4 })
const extraUrls = []
for (const u of dom.jsonld_logos) extraUrls.push({ url: u, kind: 'jsonld', score: 4 })
const touch = dom.icons.filter((i) => /apple-touch-icon/i.test(i.rel ?? '')).sort((a, b) => (parseInt(b.sizes) || 0) - (parseInt(a.sizes) || 0))[0]
if (touch?.href) extraUrls.push({ url: touch.href, kind: 'apple-touch-icon', score: 2 })
const svgIcon = dom.icons.find((i) => /svg/i.test(i.type ?? '') || /\.svg(\?|$)/i.test(i.href ?? ''))
if (svgIcon?.href) extraUrls.push({ url: svgIcon.href, kind: 'icon', score: 2 })
if (dom.og_image) extraUrls.push({ url: dom.og_image, kind: 'og:image', score: 0 })
const urlAssets = await collectUrlAssets(site?.page ?? null, extraUrls, outDir, 100)
const logos = [...domAssets, ...urlAssets]

const colors = summarizeColors(dom.colorsRaw)
if (heroBuf) colors.screenshot_palette = await screenshotPalette(heroBuf)
const fonts = summarizeFonts(dom.fonts)

if (site) await site.browser.close()

if (!logos.length) warnings.push('Geen logo-kandidaten gevonden.')
if (!colors.brand.length) warnings.push('Geen uitgesproken merkkleuren gevonden (alleen neutrale tinten).')
if (fallback) warnings.push('Geen screenshots: de browser kon de site niet laden.')

const signals = {
  url,
  final_url: finalUrl,
  http_status: status,
  hostname,
  title: dom.title,
  description: dom.description,
  lang: dom.lang,
  fallback,
  screenshots: shots,
  logos,
  colors,
  fonts,
  theme_color: colors.theme_color,
  cross_origin_sheets: dom.cross_origin_sheets,
  warnings,
  extracted_at: new Date().toISOString(),
  duration_ms: Date.now() - started,
}
writeFileSync(join(outDir, 'signals.json'), JSON.stringify(signals, null, 2))
writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ aanvraag_id: aanvraag?.id ?? null, url, event: aanvraag?.event ?? null, asana_task_gid: aanvraag?.asana_task_gid ?? null, outDir }, null, 2))

// Samenvatting voor de sessie (Claude) die de brief schrijft.
console.log('')
console.log('=== EXTRACTIE KLAAR ===')
console.log(`Map: ${outDir}`)
console.log(`Site: ${dom.title ?? '(geen titel)'} — ${finalUrl} (HTTP ${status})${fallback ? ' [FALLBACK, geen screenshots]' : ''}`)
if (!fallback) console.log(`Screenshots: hero.png, header.png, page.png`)
console.log(`Logo-kandidaten (${logos.length}):`)
for (const l of logos) console.log(`  [${l.index}] ${l.kind} score ${l.score} ${l.natural ? `${l.natural.width}×${l.natural.height}` : ''} → ${Object.values(l.files).join(', ')}  (${l.hint})`)
console.log(`Merkkleuren (top): ${colors.brand.slice(0, 6).map((c) => `${c.hex} ${(c.share * 100).toFixed(1)}%`).join(', ') || 'geen'}`)
console.log(`CTA-kleuren: ${colors.cta.map((c) => c.hex).join(', ') || 'geen'}`)
console.log(`Custom properties: ${Object.entries(colors.custom_properties).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', ') || 'geen'}`)
console.log(`Fonts per rol: ${Object.entries(fonts.by_role).map(([r, f]) => `${r}: ${f.map((x) => x.family + (x.generic ? '*' : '')).join('/')}`).join('; ') || 'geen'}`)
console.log(`Google Fonts: ${fonts.google_fonts.join(', ') || 'geen'}; Adobe Fonts: ${fonts.adobe_fonts ? 'ja' : 'nee'}; @font-face: ${fonts.font_face.slice(0, 6).join(', ') || 'geen'}`)
if (warnings.length) console.log(`Waarschuwingen: ${warnings.join(' | ')}`)
console.log(`Duur: ${((Date.now() - started) / 1000).toFixed(1)}s`)
