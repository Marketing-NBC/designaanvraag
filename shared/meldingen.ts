/**
 * De meldingsmails aan Marketing: één bij een nieuwe aanvraag, één bij een aanvulling via het
 * formulier. Puur: gegevens erin, onderwerp en HTML eruit. Het versturen doen de edge functions.
 *
 * Wat Marketing zelf in Asana doet levert geen mail op; dat weten ze al.
 */
import type { Aanvraag } from './aanvraag-schema.ts'
import { formatDateShortNl, taskTitle } from './asana-title.ts'
import { MELDING_ONTVANGERS } from './contact.ts'
import { citaat, escapeHtml, gegevensTabel, knop, mailOpmaak, waarschuwingBlok } from './mail.ts'
import type { MailBericht } from './mail.ts'
import { DESIGN_MODES, describeRequestTypes, locatieLabel } from './request-types.ts'
import type { Locatie, RequestTypeKey } from './request-types.ts'
import { SPOED_WERKDAGEN } from './spoed.ts'

const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']

/** "2026-12-11" → "vrijdag 11 december 2026". Op de ISO-string, dus zonder tijdzone-gedoe. */
export function datumLang(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return `${DAGEN[d.getUTCDay()]} ${formatDateShortNl(iso)}`
}

export function ontvangerVoor(locatie: Locatie): string {
  return MELDING_ONTVANGERS[locatie] ?? MELDING_ONTVANGERS.nbc
}

/** Onderwerp: "[SPOED] Nieuwe aanvraag: EY - 11 december - Torenscherm, Vlaggen". */
function onderwerp(soort: string, v: { spoed: boolean; nietInAsana: boolean; event: string; eventDatum: string; wat: string }): string {
  const voor = [v.spoed ? '[SPOED]' : '', v.nietInAsana ? '[Niet in Asana]' : ''].filter(Boolean).join(' ')
  const kern = `${soort}: ${[v.event.trim(), formatDateShortNl(v.eventDatum, false), v.wat].join(' - ')}`
  return `${voor ? `${voor} ` : ''}${kern}`.slice(0, 250)
}

function link(href: string, tekst = href): string {
  return `<a href="${escapeHtml(href)}" style="color:#165e5a;">${escapeHtml(tekst)}</a>`
}

function leegOf(tekst: string, html = escapeHtml(tekst)): string {
  return tekst ? html : '<span style="color:#828b8d;">niet opgegeven</span>'
}

function spoedTekst(spoed: boolean): string {
  return spoed ? '<strong style="color:#c0392b;">Ja</strong>' : 'Nee'
}

function kopje(tekst: string): string {
  return `<p style="margin:24px 0 4px;font-weight:bold;">${escapeHtml(tekst)}</p>`
}

function taakRegel(naam: string): string {
  return `<p style="margin:0 0 16px;font-size:17px;font-weight:bold;">${escapeHtml(naam)}</p>`
}

export interface NieuweAanvraagMail {
  aanvraag: Aanvraag
  aanvraagId: string
  spoed: boolean
  werkdagenTotEvent: number | null
  asanaUrl: string | null
  /** Waarom er geen taak is; alleen gezet als er geen is. */
  asanaFout: string | null
  bijlagen: string[]
}

export function renderNieuweAanvraagMail(m: NieuweAanvraagMail): MailBericht {
  const a = m.aanvraag
  const nietInAsana = !m.asanaUrl
  const delen: string[] = []

  if (nietInAsana) {
    delen.push(waarschuwingBlok(
      `<strong>Deze aanvraag staat niet in Asana.</strong> ${escapeHtml(m.asanaFout ?? 'Er is geen taak aangemaakt.')}<br>`
        + 'Alle gegevens staan hieronder, zodat er niets verloren gaat. Maak de taak met de hand aan.',
    ))
  }
  if (m.spoed) {
    const n = m.werkdagenTotEvent
    delen.push(waarschuwingBlok(
      `<strong>Spoed:</strong> ${n === null ? `minder dan ${SPOED_WERKDAGEN}` : `nog ${n}`} werkdag${n === 1 ? '' : 'en'} tot het event.`,
    ))
  }

  delen.push(taakRegel(taskTitle(a)))
  const rijen: [string, string][] = [
    ['Locatie', escapeHtml(locatieLabel(a.locatie))],
    ['Aanvrager', escapeHtml(a.naam)],
    ['Event', escapeHtml(a.event)],
    ['Eventdatum', escapeHtml(datumLang(a.event_datum))],
    ['Deadline', `<strong>${escapeHtml(datumLang(a.deadline))}</strong>`],
    ['Aanvraag', escapeHtml(describeRequestTypes(a.aanvraag_types, a.anders_tekst))],
    ['Design', escapeHtml(DESIGN_MODES.find((d) => d.key === a.design_modus)?.label ?? a.design_modus)],
    ['Spoed', spoedTekst(m.spoed)],
    ['Website', leegOf(a.website, a.website ? link(a.website) : '')],
    ['Schijf', leegOf(a.schijf_locatie)],
  ]
  if (m.bijlagen.length) rijen.push(['Meegestuurd', escapeHtml(m.bijlagen.join(', '))])
  delen.push(gegevensTabel(rijen))

  if (a.omschrijving) delen.push(kopje('Wensen en bijzonderheden'), citaat(a.omschrijving))
  // Het menu staat normaal in de Asana-taak. Is die er niet, dan hoort het hier, anders is het weg.
  if (nietInAsana && a.menu_tekst) delen.push(kopje('Menu'), citaat(a.menu_tekst))

  if (m.asanaUrl) delen.push(knop(m.asanaUrl, 'Open de taak in Asana'), `<p style="margin:4px 0 0;font-size:13px;">${link(m.asanaUrl)}</p>`)
  delen.push(`<p style="margin:20px 0 0;font-size:12px;color:#828b8d;">Aanvraag ${escapeHtml(m.aanvraagId)}</p>`)

  return {
    aan: [ontvangerVoor(a.locatie)],
    onderwerp: onderwerp('Nieuwe aanvraag', {
      spoed: m.spoed,
      nietInAsana,
      event: a.event,
      eventDatum: a.event_datum,
      wat: describeRequestTypes(a.aanvraag_types, a.anders_tekst),
    }),
    html: mailOpmaak(`Nieuwe designaanvraag van ${a.naam}`, delen.join('\n')),
  }
}

export interface AanvullingMail {
  /** Wie de aanvulling stuurt; hoeft niet de oorspronkelijke aanvrager te zijn. */
  naam: string
  toelichting: string
  link: string
  schijfLocatie: string
  /** Types die de collega erbij vroeg. */
  extraTypes: RequestTypeKey[]
  andersTekst: string
  aanvraag: {
    naam: string
    locatie: Locatie
    event: string
    spoed: boolean
    /** Na deze aanvulling, dus met een eventueel nieuwe datum. */
    eventDatum: string
    deadline: string
    eventDatumGewijzigd: boolean
    deadlineGewijzigd: boolean
    /** Alle types na deze aanvulling. */
    types: RequestTypeKey[]
  }
  taakNaam: string
  asanaUrl: string | null
  /** Velden die in Asana zijn bijgewerkt. */
  bijgewerkt: string[]
  bijlagen: string[]
  /** De taak stond op Klaar of was afgevinkt en is heropend. */
  heropend: boolean
  /** De taak stond in Mee bezig en is naar Feedback verplaatst. */
  naarFeedback: boolean
  /** Gezet als de reactie niet in Asana terechtkwam. */
  asanaFout: string | null
}

export function renderAanvullingMail(m: AanvullingMail): MailBericht {
  const a = m.aanvraag
  const delen: string[] = []

  if (m.asanaFout) {
    delen.push(waarschuwingBlok(
      `<strong>Deze aanvulling staat niet in Asana.</strong> ${escapeHtml(m.asanaFout)}<br>`
        + 'Alles staat hieronder, zodat er niets verloren gaat. Zet het met de hand bij de taak.',
    ))
  }
  if (m.heropend) {
    delen.push(waarschuwingBlok('<strong>Deze taak was al afgerond en is heropend.</strong> Hij staat nu in de kolom Feedback, zonder planningsdatum.'))
  } else if (m.naarFeedback) {
    delen.push(waarschuwingBlok('<strong>Er is feedback op werk waar je mee bezig bent.</strong> De taak staat nu in de kolom Feedback.'))
  }

  delen.push(taakRegel(m.taakNaam))
  delen.push(`<p style="margin:0;font-weight:bold;">Aanvulling van ${escapeHtml(m.naam)}</p>`, citaat(m.toelichting))

  const gewijzigd = ' <span style="color:#165e5a;font-weight:bold;">(gewijzigd)</span>'
  const rijen: [string, string][] = [
    ['Locatie', escapeHtml(locatieLabel(a.locatie))],
    ['Aanvrager', escapeHtml(a.naam)],
    ['Event', escapeHtml(a.event)],
    ['Eventdatum', escapeHtml(datumLang(a.eventDatum)) + (a.eventDatumGewijzigd ? gewijzigd : '')],
    ['Deadline', `<strong>${escapeHtml(datumLang(a.deadline))}</strong>` + (a.deadlineGewijzigd ? gewijzigd : '')],
    ['Aanvraag', escapeHtml(describeRequestTypes(a.types, m.andersTekst))],
  ]
  if (m.extraTypes.length) rijen.push(['Erbij gevraagd', `<strong>${escapeHtml(describeRequestTypes(m.extraTypes, m.andersTekst))}</strong>`])
  rijen.push(['Spoed', spoedTekst(a.spoed)])
  if (m.link) rijen.push(['Materiaal', link(m.link)])
  if (m.schijfLocatie) rijen.push(['Schijf', escapeHtml(m.schijfLocatie)])
  if (m.bijlagen.length) rijen.push(['Meegestuurd', escapeHtml(m.bijlagen.join(', '))])
  if (m.bijgewerkt.length) rijen.push(['Bijgewerkt in Asana', escapeHtml(m.bijgewerkt.join(', '))])
  delen.push(`<div style="margin-top:20px;">${gegevensTabel(rijen)}</div>`)

  if (m.asanaUrl) delen.push(knop(m.asanaUrl, 'Open de taak in Asana'), `<p style="margin:4px 0 0;font-size:13px;">${link(m.asanaUrl)}</p>`)

  return {
    aan: [ontvangerVoor(a.locatie)],
    onderwerp: onderwerp('Aanvulling', {
      spoed: a.spoed,
      nietInAsana: Boolean(m.asanaFout),
      event: a.event,
      eventDatum: a.eventDatum,
      wat: describeRequestTypes(a.types, m.andersTekst),
    }),
    html: mailOpmaak(`Aanvulling van ${m.naam}`, delen.join('\n')),
  }
}
