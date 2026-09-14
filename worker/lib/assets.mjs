import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { candidateShot, fetchViaPage } from './browser.mjs'
import { log } from './config.mjs'

const EXT_BY_TYPE = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' }

function extOf(contentType, url) {
  const t = String(contentType).split(';')[0].trim().toLowerCase()
  if (EXT_BY_TYPE[t]) return EXT_BY_TYPE[t]
  const m = String(url ?? '').match(/\.(svg|png|jpe?g|webp|avif|gif|ico)(\?|#|$)/i)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'bin'
}

/** Maakt een bekijkbare PNG (wit vlak, gecentreerd) van een logo-bestand; SVG wordt gerasterd. */
async function toViewPng(buffer, ext) {
  try {
    let img = sharp(buffer, ext === 'svg' ? { density: 300 } : undefined)
    const m = await img.metadata()
    if (!m.width || !m.height) return null
    img = img.resize({ width: 900, height: 500, fit: 'inside', withoutEnlargement: false })
    // Twee versies: op wit en op donker, zodat lichte logo's ook zichtbaar zijn.
    const onWhite = await img.clone().flatten({ background: '#ffffff' }).extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#ffffff' }).png().toBuffer()
    const onDark = await sharp(buffer, ext === 'svg' ? { density: 300 } : undefined)
      .resize({ width: 900, height: 500, fit: 'inside' })
      .flatten({ background: '#1a1a1a' })
      .extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#1a1a1a' })
      .png()
      .toBuffer()
    return { onWhite, onDark, width: m.width, height: m.height }
  } catch {
    return null
  }
}

/**
 * Downloadt en normaliseert de beste logo-kandidaten.
 * Schrijft per kandidaat: logo-<i>.<ext> (origineel), logo-<i>.view.png (op wit), logo-<i>.dark.png (op donker),
 * logo-<i>.shot.png (element-screenshot). Geeft metadata terug voor signals.json.
 */
export async function collectLogoAssets(page, candidates, outDir, { max = 4 } = {}) {
  const out = []
  for (const c of candidates.slice(0, max)) {
    const entry = { index: c.index, kind: c.kind, score: c.score, hint: c.hint.slice(0, 120), width: c.width, height: c.height, files: {} }
    let buffer = null, ext = null
    if (c.inline_svg) {
      let svg = c.inline_svg
      if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
      buffer = Buffer.from(svg, 'utf8')
      ext = 'svg'
    } else if (c.src) {
      const got = await fetchViaPage(page, c.src)
      if (got) {
        buffer = got.buffer
        ext = extOf(got.contentType, c.src)
      }
    }
    if (buffer && ext !== 'bin') {
      const orig = `logo-${c.index}.${ext}`
      writeFileSync(join(outDir, orig), buffer)
      entry.files.original = orig
      entry.bytes = buffer.length
      const view = await toViewPng(buffer, ext)
      if (view) {
        writeFileSync(join(outDir, `logo-${c.index}.view.png`), view.onWhite)
        writeFileSync(join(outDir, `logo-${c.index}.dark.png`), view.onDark)
        entry.files.view = `logo-${c.index}.view.png`
        entry.files.dark = `logo-${c.index}.dark.png`
        entry.natural = { width: view.width, height: view.height }
      }
    }
    if (page && c.index !== undefined && c.kind !== 'jsonld' && c.kind !== 'icon') {
      const shot = await candidateShot(page, c.index)
      if (shot) {
        writeFileSync(join(outDir, `logo-${c.index}.shot.png`), shot)
        entry.files.shot = `logo-${c.index}.shot.png`
        if (!entry.files.view) {
          // Screenshot als bekijkbare versie op wit en donker.
          const v = await toViewPng(shot, 'png')
          if (v) {
            writeFileSync(join(outDir, `logo-${c.index}.view.png`), v.onWhite)
            writeFileSync(join(outDir, `logo-${c.index}.dark.png`), v.onDark)
            entry.files.view = `logo-${c.index}.view.png`
            entry.files.dark = `logo-${c.index}.dark.png`
          }
        }
      }
    }
    if (Object.keys(entry.files).length) out.push(entry)
    else log('logo-kandidaat overgeslagen (niets op te halen)', { index: c.index, src: c.src })
  }
  return out
}

/** Downloadt losse URL-assets (icons, og:image, JSON-LD-logo) zonder DOM-element. */
export async function collectUrlAssets(page, items, outDir, startIndex) {
  const out = []
  let i = startIndex
  for (const it of items) {
    if (!it.url) continue
    const got = await fetchViaPage(page, it.url)
    if (!got) continue
    const ext = extOf(got.contentType, it.url)
    if (ext === 'bin' || ext === 'ico') continue
    const orig = `logo-${i}.${ext}`
    writeFileSync(join(outDir, orig), got.buffer)
    const entry = { index: i, kind: it.kind, score: it.score, hint: it.url.slice(0, 120), files: { original: orig }, bytes: got.buffer.length }
    const view = await toViewPng(got.buffer, ext)
    if (view) {
      writeFileSync(join(outDir, `logo-${i}.view.png`), view.onWhite)
      writeFileSync(join(outDir, `logo-${i}.dark.png`), view.onDark)
      entry.files.view = `logo-${i}.view.png`
      entry.files.dark = `logo-${i}.dark.png`
      entry.natural = { width: view.width, height: view.height }
    }
    out.push(entry)
    i++
  }
  return out
}

/** Grofmazig kleurenpalet uit de hero-screenshot (cross-check, niet leidend). */
export async function screenshotPalette(pngBuffer) {
  const { data, info } = await sharp(pngBuffer).resize({ width: 96 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const counts = new Map()
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] & 0xf0, g = data[i + 1] & 0xf0, b = data[i + 2] & 0xf0
    const key = (r << 16) | (g << 8) | b
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const total = data.length / info.channels
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, n]) => ({ hex: '#' + k.toString(16).padStart(6, '0'), share: +(n / total).toFixed(3) }))
}
