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

function modusLabel(a: Aanvraag): string {
  return DESIGN_MODES.find((m) => m.key === a.design_modus)?.label ?? a.design_modus
}

/** Beschrijving van de aanvraag: html_notes plus een platte fallback. */
export function renderNotes(a: Aanvraag, opts: { aanvraagId: string; bijlagen?: string[] }): { html: string; plain: string } {
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
  htmlLines.push(
    a.website
      ? `<strong>Website:</strong> <a href="${escapeXml(a.website)}">${escapeXml(hostOf(a.website))}</a>`
      : `<strong>Website:</strong> <em>niet opgegeven</em>`,
  )
  htmlLines.push(
    a.schijf_locatie
      ? `<strong>Locatie op de schijf:</strong> <code>${escapeXml(a.schijf_locatie)}</code>`
      : `<strong>Locatie op de schijf:</strong> <em>niet opgegeven</em>`,
  )
  if (opts.bijlagen?.length) {
    htmlLines.push(`<strong>Meegestuurd:</strong> ${escapeXml(opts.bijlagen.join(', '))}`)
  }
  htmlLines.push('')
  htmlLines.push('<h2>Wensen en bijzonderheden</h2>')
  htmlLines.push(a.omschrijving ? `<blockquote>${escapeXml(a.omschrijving)}</blockquote>` : '<em>Geen bijzonderheden opgegeven.</em>')
  htmlLines.push('')
  htmlLines.push('<hr/>')
  htmlLines.push('<h2>Huisstijl</h2>')
  htmlLines.push(
    a.website
      ? `${HUISSTIJL_MARKER} van <a href="${escapeXml(a.website)}">${escapeXml(hostOf(a.website))}</a>. Dit duurt ongeveer vijf minuten; logo, kleuren en fonts komen hier en als bijlage.`
      : 'De aanvrager gaf geen website op, dus er is geen huisstijl opgehaald.',
  )
  htmlLines.push('')
  htmlLines.push(`<em>Aanvraag ${escapeXml(opts.aanvraagId)} via het designaanvraag-formulier.</em>`)

  const plainLines: string[] = rows.map(([k, v]) => `${k}: ${v}`)
  plainLines.push(`Website: ${a.website || 'niet opgegeven'}`)
  plainLines.push(`Locatie op de schijf: ${a.schijf_locatie || 'niet opgegeven'}`)
  if (opts.bijlagen?.length) plainLines.push(`Meegestuurd: ${opts.bijlagen.join(', ')}`)
  plainLines.push('', 'Wensen en bijzonderheden', a.omschrijving || 'Geen bijzonderheden opgegeven.', '')
  plainLines.push(
    'Huisstijl',
    a.website ? `${HUISSTIJL_MARKER} van ${hostOf(a.website)}.` : 'De aanvrager gaf geen website op, dus er is geen huisstijl opgehaald.',
    '',
    `Aanvraag ${opts.aanvraagId} via het designaanvraag-formulier.`,
  )

  return { html: `<body>${htmlLines.join('\n')}</body>`, plain: plainLines.join('\n') }
}

/**
 * Reactie onder de bestaande taak bij een aanvulling. Comments zijn strenger dan de beschrijving:
 * alleen tekst, strong/em, a en ul/li — geen koppen, geen img, geen blockquote. Vandaar de kale
 * opbouw met gewone regeleinden.
 */
export function renderAanvullingComment(v: {
  naam: string
  toelichting: string
  /** Velden die daadwerkelijk zijn aangepast; leeg betekent dat alleen deze tekst binnenkomt. */
  bijgewerkt: string[]
  link: string
  /** Pad dat niet is overgenomen omdat het veld Schijf al gevuld was. */
  schijfNietOvergenomen: string
  /** Namen van de bestanden die als bijlage bij deze taak zijn gezet. */
  bijlagen?: string[]
}): string {
  const lines: string[] = [`<strong>Aanvulling van ${escapeXml(v.naam)}</strong>`, '', escapeXml(v.toelichting), '']

  if (v.bijgewerkt.length) {
    lines.push(`<strong>Bijgewerkt in deze taak:</strong> ${escapeXml(v.bijgewerkt.join(', '))}`)
  }
  if (v.bijlagen?.length) {
    lines.push(`<strong>Meegestuurd:</strong> ${escapeXml(v.bijlagen.join(', '))} (als bijlage bij deze taak)`)
  }
  if (v.link) {
    lines.push(`<strong>Materiaal:</strong> <a href="${escapeXml(v.link)}">${escapeXml(hostOf(v.link))}</a>`)
  }
  if (v.schijfNietOvergenomen) {
    lines.push(
      `<strong>Schijf volgens de aanvrager:</strong> ${escapeXml(v.schijfNietOvergenomen)} — het veld Schijf was al ingevuld, dus dat is niet overschreven.`,
    )
  }
  if (!v.bijgewerkt.length && !v.link && !v.schijfNietOvergenomen && !v.bijlagen?.length) {
    lines.push('<em>Er zijn geen velden aangepast; dit is alleen een toelichting.</em>')
  }

  return `<body>${lines.join('\n')}</body>`
}
