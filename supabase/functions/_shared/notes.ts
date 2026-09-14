import type { Aanvraag } from './shared/aanvraag-schema.ts'
import { DESIGN_MODES, describeRequestTypes } from './shared/request-types.ts'

/**
 * Asana `html_notes`: strikt XML, alleen toegestane tags, alles in <body>.
 * Toegestaan in taken: strong, em, u, s, code, ol, ul, li, a (href), blockquote, pre, h1, h2, hr, img.
 * Geen tabellen. Regeleinden zijn gewone \n.
 */

/** Deze regel staat onder "Huisstijl" tot de worker hem vervangt. De worker zoekt hierop. */
export const HUISSTIJL_MARKER = 'Wordt automatisch opgehaald'

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const nlDate = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' })

export function formatDateNl(iso: string): string {
  return nlDate.format(new Date(`${iso}T12:00:00Z`))
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function taskName(a: Aanvraag): string {
  return `Aanvraag ${describeRequestTypes(a.aanvraag_types, a.anders_tekst)} – ${a.event}`.slice(0, 250)
}

function modusLabel(a: Aanvraag): string {
  return DESIGN_MODES.find((m) => m.key === a.design_modus)?.label ?? a.design_modus
}

/** Beschrijving van de aanvraag: html_notes plus een platte fallback. */
export function renderNotes(a: Aanvraag, opts: { aanvraagId: string }): { html: string; plain: string } {
  const rows: [string, string][] = [
    ['Aanvrager', a.naam],
    ['Event', a.event],
    ['Eventdatum', formatDateNl(a.event_datum)],
    ['Uiterlijk nodig op', formatDateNl(a.deadline)],
    ['Aanvraag', describeRequestTypes(a.aanvraag_types, a.anders_tekst)],
    ['Design', modusLabel(a)],
  ]

  const htmlLines: string[] = []
  for (const [k, v] of rows) htmlLines.push(`<strong>${escapeXml(k)}:</strong> ${escapeXml(v)}`)
  htmlLines.push(`<strong>Website:</strong> <a href="${escapeXml(a.website)}">${escapeXml(hostOf(a.website))}</a>`)
  htmlLines.push(
    a.schijf_locatie
      ? `<strong>Locatie op de schijf:</strong> <code>${escapeXml(a.schijf_locatie)}</code>`
      : `<strong>Locatie op de schijf:</strong> <em>niet opgegeven</em>`,
  )
  htmlLines.push('')
  htmlLines.push('<h2>Wensen en bijzonderheden</h2>')
  htmlLines.push(a.omschrijving ? `<blockquote>${escapeXml(a.omschrijving)}</blockquote>` : '<em>Geen bijzonderheden opgegeven.</em>')
  htmlLines.push('')
  htmlLines.push('<hr/>')
  htmlLines.push('<h2>Huisstijl</h2>')
  htmlLines.push(
    `${HUISSTIJL_MARKER} van <a href="${escapeXml(a.website)}">${escapeXml(hostOf(a.website))}</a>. Dit duurt ongeveer vijf minuten; logo, kleuren en fonts komen hier en als bijlage.`,
  )
  htmlLines.push('')
  htmlLines.push(`<em>Aanvraag ${escapeXml(opts.aanvraagId)} via het designaanvraag-formulier.</em>`)

  const plainLines: string[] = rows.map(([k, v]) => `${k}: ${v}`)
  plainLines.push(`Website: ${a.website}`)
  plainLines.push(`Locatie op de schijf: ${a.schijf_locatie || 'niet opgegeven'}`)
  plainLines.push('', 'Wensen en bijzonderheden', a.omschrijving || 'Geen bijzonderheden opgegeven.', '')
  plainLines.push('Huisstijl', `${HUISSTIJL_MARKER} van ${hostOf(a.website)}.`, '', `Aanvraag ${opts.aanvraagId} via het designaanvraag-formulier.`)

  return { html: `<body>${htmlLines.join('\n')}</body>`, plain: plainLines.join('\n') }
}
