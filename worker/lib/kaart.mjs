import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { chromiumExecutable, REPO_DIR, WORKER_DIR } from './config.mjs'
import { escapeXml, hostOf } from './notes.mjs'

const ROLE_NL = { primary: 'primair', secondary: 'secundair', accent: 'accent', background: 'achtergrond', text: 'tekst', other: 'overig' }
const SOURCE_NL = { google: 'Google Fonts', adobe: 'Adobe Fonts', custom: 'eigen font', system: 'systeemfont', unknown: 'bron onbekend' }

function mimeOf(file) {
  if (/\.svg$/i.test(file)) return 'image/svg+xml'
  if (/\.png$/i.test(file)) return 'image/png'
  if (/\.jpe?g$/i.test(file)) return 'image/jpeg'
  if (/\.webp$/i.test(file)) return 'image/webp'
  return 'application/octet-stream'
}

function fontDesc(f) {
  return `${f.family}${f.weight ? ' ' + f.weight : ''} · ${SOURCE_NL[f.source] ?? f.source}${f.fallback ? ` · fallback ${f.fallback}` : ''}`
}

function weightNum(w) {
  const m = String(w ?? '').match(/\d{3}/)
  return m ? m[0] : '700'
}

/**
 * Rendert de huisstijl-kaart (1600×1000 PNG).
 * @param {object} p
 * @param {import('../../shared/brand-brief-schema.ts').BrandBrief} p.brief
 * @param {object} p.signals
 * @param {string} p.outDir
 * @param {string|null} p.logoFile  bestandsnaam in outDir van het logo (origineel of view)
 */
export async function renderKaart({ brief, signals, outDir, logoFile }) {
  let html = readFileSync(join(WORKER_DIR, 'kaart', 'template.html'), 'utf8')
  // NBC-fonts inline als data-URI: about:blank mag geen file:// laden.
  const fontDir = join(REPO_DIR, 'web', 'src', 'assets', 'fonts')
  for (const f of ['Pockota-Regular', 'Pockota-Light', 'AreaNormal-Regular', 'AreaNormal-Extrabold']) {
    try {
      const b64 = readFileSync(join(fontDir, `${f}.otf`)).toString('base64')
      html = html.split(`{{FONT_DIR}}/${f}.otf`).join(`data:font/otf;base64,${b64}`)
    } catch {
      /* zonder NBC-font valt de kaart terug op Georgia/Arial */
    }
  }

  const googleFamilies = [brief.fonts.heading, brief.fonts.body].filter((f) => f.source === 'google').map((f) => f.family)
  const fontLink = googleFamilies.length
    ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${googleFamilies.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;700;800`).join('&')}&display=swap">`
    : ''

  const dark = brief.logo.prefers_dark_bg
  let logoHtml = '<div class="geen">Geen bruikbaar logo gevonden op de site.<br>Vraag het logo op bij de klant.</div>'
  if (logoFile) {
    const buf = readFileSync(join(outDir, logoFile))
    logoHtml = `<img src="data:${mimeOf(logoFile)};base64,${buf.toString('base64')}" alt="">`
  }
  const swatches = brief.colors
    .map((c) => `<div class="sw"><i style="background:${escapeXml(c.hex)}"></i><div><b>${escapeXml(c.hex.toUpperCase())}</b><span>${escapeXml([ROLE_NL[c.role] ?? c.role, c.name].filter(Boolean).join(' · '))}</span></div></div>`)
    .join('')
  const notes = brief.style_notes.map((n) => `<li>${escapeXml(n)}</li>`).join('')
  const warnings = brief.warnings.length ? `Let op: ${escapeXml(brief.warnings.slice(0, 2).join(' · '))}` : `Bron: ${escapeXml(signals.title ?? signals.hostname ?? '')}`
  const date = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' }).format(new Date())

  const repl = {
    '<!--FONT_LINK-->': fontLink,
    '{{LOGO_BG}}': dark ? '#141414' : '#ffffff',
    '{{LOGO_FG}}': dark ? 'rgba(255,255,255,.7)' : '#596165',
    '{{EYEBROW_CLASS}}': dark ? 'light' : '',
    '{{LOGO_HTML}}': logoHtml,
    '{{LOGO_META}}': escapeXml(logoFile ? `${logoFile}${brief.logo.reason ? ' · ' + brief.logo.reason : ''}` : ''),
    '{{BRAND_NAME}}': escapeXml(brief.brand_name),
    '{{HOST}}': escapeXml(hostOf(signals.final_url ?? signals.url ?? '')),
    '{{DATE}}': escapeXml(date),
    '{{SWATCHES}}': swatches,
    '{{HEADING_FAMILY_CSS}}': `'${brief.fonts.heading.family.replace(/'/g, '')}', ${brief.fonts.heading.fallback || 'sans-serif'}`,
    '{{HEADING_WEIGHT}}': weightNum(brief.fonts.heading.weight),
    '{{HEADING_SAMPLE}}': escapeXml(`${brief.fonts.heading.family} – Ruimte voor magie`),
    '{{HEADING_DESC}}': escapeXml(fontDesc(brief.fonts.heading)),
    '{{BODY_FAMILY_CSS}}': `'${brief.fonts.body.family.replace(/'/g, '')}', ${brief.fonts.body.fallback || 'sans-serif'}`,
    '{{BODY_WEIGHT}}': weightNum(brief.fonts.body.weight) === '800' ? '400' : weightNum(brief.fonts.body.weight),
    '{{BODY_SAMPLE}}': escapeXml(`${brief.fonts.body.family} – De snelle bruine vos springt over de luie hond.`),
    '{{BODY_DESC}}': escapeXml(fontDesc(brief.fonts.body)),
    '{{NOTES}}': notes,
    '{{WARNINGS}}': warnings,
    '{{CONFIDENCE}}': String(Math.round(brief.confidence * 100)),
  }
  for (const [k, v] of Object.entries(repl)) html = html.split(k).join(v)

  const browser = await chromium.launch({ executablePath: chromiumExecutable(), args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  await page.waitForTimeout(400)
  const png = await page.screenshot({ type: 'png', fullPage: false })
  await browser.close()
  return png
}
