/**
 * Bouwt de sectie "Huisstijl" voor de Asana-taak (html_notes) en de comment (html_text).
 * Zelfde marker als supabase/functions/_shared/notes.ts.
 */
export const HUISSTIJL_MARKER = 'Wordt automatisch opgehaald'

export function escapeXml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const ROLE_NL = { primary: 'primair', secondary: 'secundair', accent: 'accent', background: 'achtergrond', text: 'tekst', other: 'overig' }
const SOURCE_NL = { google: 'Google Fonts', adobe: 'Adobe Fonts', custom: 'eigen font', system: 'systeemfont', unknown: 'bron onbekend' }

function fontLine(f) {
  const parts = [f.family]
  if (f.weight) parts.push(f.weight)
  const src = SOURCE_NL[f.source] ?? f.source
  return `${parts.join(' ')} (${src}${f.fallback ? `, fallback ${f.fallback}` : ''})`
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * @param {object} p
 * @param {import('../../shared/brand-brief-schema.ts').BrandBrief} p.brief
 * @param {string} p.website
 * @param {{ logo?: string, kaart?: string, screenshot?: string }} p.attachmentNames  bestandsnamen van de bijlagen
 * @param {string|null} p.kaartGid  Asana-gid van de huisstijl-kaart (voor inline weergave)
 * @param {string|null} p.sessionUrl
 */
export function renderHuisstijlSection({ brief, website, attachmentNames, kaartGid, sessionUrl }) {
  const lines = []
  lines.push(`<strong>Merk:</strong> ${escapeXml(brief.brand_name)}`)
  if (attachmentNames.logo) {
    lines.push(
      `<strong>Logo:</strong> zie bijlage <em>${escapeXml(attachmentNames.logo)}</em>${brief.logo.prefers_dark_bg ? ' (licht logo, gebruik een donkere achtergrond)' : ''}${brief.logo.reason ? ` – ${escapeXml(brief.logo.reason)}` : ''}`,
    )
  } else {
    lines.push('<strong>Logo:</strong> <em>geen bruikbaar logo gevonden op de site</em>')
  }
  lines.push('<strong>Kleuren:</strong>')
  lines.push('<ul>')
  for (const c of brief.colors) {
    const bits = [c.hex, ROLE_NL[c.role] ?? c.role]
    if (c.name) bits.push(c.name)
    lines.push(`<li>${escapeXml(bits.join(' – '))}${c.source ? ` <em>(${escapeXml(c.source)})</em>` : ''}</li>`)
  }
  lines.push('</ul>')
  lines.push(`<strong>Fonts:</strong> koppen ${escapeXml(fontLine(brief.fonts.heading))}; lopende tekst ${escapeXml(fontLine(brief.fonts.body))}`)
  lines.push('<strong>Stijl:</strong>')
  lines.push('<ul>')
  for (const n of brief.style_notes) lines.push(`<li>${escapeXml(n)}</li>`)
  lines.push('</ul>')
  if (kaartGid) lines.push(`<img data-asana-gid="${escapeXml(kaartGid)}">`)
  const pct = Math.round(brief.confidence * 100)
  const meta = [`Automatisch opgehaald van <a href="${escapeXml(website)}">${escapeXml(hostOf(website))}</a>`, `zekerheid ${pct}%`]
  if (brief.warnings.length) meta.push(`let op: ${brief.warnings.map(escapeXml).join('; ')}`)
  if (sessionUrl) meta.push(`<a href="${escapeXml(sessionUrl)}">sessie</a>`)
  lines.push(`<em>${meta.join(' · ')}.</em>`)
  return lines.join('\n')
}

/**
 * Vervangt de markerregel in bestaande html_notes door de sectie. Geen marker → sectie achteraan.
 * Geeft null terug als de notes leeg zijn (dan bouwen we ze niet zelf op).
 */
export function mergeIntoNotes(existingHtml, section) {
  const html = String(existingHtml ?? '')
  const bodyMatch = html.match(/^<body>([\s\S]*)<\/body>$/)
  if (!bodyMatch) return null
  const inner = bodyMatch[1]
  const markerLine = inner.split('\n').find((l) => l.includes(HUISSTIJL_MARKER))
  let next
  if (markerLine) next = inner.replace(markerLine, section)
  else next = `${inner.replace(/\s+$/, '')}\n\n<hr/>\n<h2>Huisstijl</h2>\n${section}`
  return `<body>${next}</body>`
}

export function renderComment({ brief, website, attachmentNames, ok = true }) {
  if (!ok) return null
  const cols = brief.colors
    .slice(0, 4)
    .map((c) => `${c.hex} (${ROLE_NL[c.role] ?? c.role})`)
    .join(', ')
  return (
    `<body>Huisstijl van <a href="${escapeXml(website)}">${escapeXml(hostOf(website))}</a> automatisch opgehaald: ` +
    `${escapeXml(cols)}; koppen ${escapeXml(brief.fonts.heading.family)}, tekst ${escapeXml(brief.fonts.body.family)}. ` +
    `Logo${attachmentNames.logo ? ` (${escapeXml(attachmentNames.logo)})` : ''} en huisstijl-kaart staan als bijlage; details in de beschrijving.</body>`
  )
}

export function renderFailureComment({ website, reason, rerunHint }) {
  return (
    `<body>Huisstijl kon niet automatisch worden opgehaald van <a href="${escapeXml(website)}">${escapeXml(hostOf(website))}</a>. ` +
    `Reden: ${escapeXml(reason)}. ${escapeXml(rerunHint ?? 'Kijk zelf even op de site, of vraag Devi de extractie opnieuw te starten.')}</body>`
  )
}
