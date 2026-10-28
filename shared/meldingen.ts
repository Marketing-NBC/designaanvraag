/**
 * De meldingsmails aan Marketing: één bij een nieuwe aanvraag, één bij een aanvulling via het
 * formulier. Puur: gegevens erin, onderwerp en HTML eruit. Het versturen doen de edge functions.
 *
 * Wat Marketing zelf in Asana doet levert geen mail op; dat weten ze al.
 */
import type { Aanvraag } from './aanvraag-schema.ts'
import { formatDateShortNl, kortVan, taskTitle } from './asana-title.ts'
import { MELDING_ONTVANGERS } from './contact.ts'
import { citaat, escapeHtml, gegevensTabel, knop, mailOpmaak, ruimte, themaVoor, waarschuwingBlok } from './mail.ts'
import type { MailBericht, Thema } from './mail.ts'
import { DESIGN_MODES, describeRequestTypes, locatieLabel } from './request-types.ts'
import type { Locatie, RequestTypeKey, Soort } from './request-types.ts'
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

/**
 * Onderwerp: "[SPOED] Nieuwe aanvraag: EY - 11 december - Torenscherm, Vlaggen". Een interne
 * aanvraag heeft geen event; daar staat het begin van de vraag: "Nieuwe aanvraag: Intern - Nieuwe
 * visitekaartjes voor…".
 */
function onderwerp(wat: string, v: {
  spoed: boolean
  nietInAsana: boolean
  soort: Soort
  event: string
  eventDatum: string | null
  types: string
  omschrijving: string
}): string {
  const voor = [v.spoed ? '[SPOED]' : '', v.nietInAsana ? '[Niet in Asana]' : ''].filter(Boolean).join(' ')
  const delen = v.soort === 'intern'
    ? ['Intern', kortVan(v.omschrijving)]
    : [v.event.trim(), v.eventDatum ? formatDateShortNl(v.eventDatum, false) : '', v.types]
  const kern = `${wat}: ${delen.filter(Boolean).join(' - ')}`
  return `${voor ? `${voor} ` : ''}${kern}`.slice(0, 250)
}

/** Spoed meet tot het event; een interne aanvraag heeft er geen, daar telt de deadline. */
function spoedPeil(soort: Soort): string {
  return soort === 'intern' ? 'de deadline' : 'het event'
}

function link(href: string, thema: Thema, tekst = href): string {
  return `<a href="${escapeHtml(href)}" style="color:${thema.link};">${escapeHtml(tekst)}</a>`
}

/** De deadline voor in de mail; bij een interne aanvraag mag hij ontbreken. */
function deadlineTekst(deadline: string | null): string {
  return deadline ? `<strong>${escapeHtml(datumLang(deadline))}</strong>` : 'Geen deadline'
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
  const intern = a.soort === 'intern'
  const nietInAsana = !m.asanaUrl
  const thema = themaVoor(a.locatie)
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
      `<strong>Spoed:</strong> ${n === null ? `minder dan ${SPOED_WERKDAGEN}` : `nog ${n}`} werkdag${n === 1 ? '' : 'en'} tot ${spoedPeil(a.soort)}.`,
    ))
  }

  delen.push(taakRegel(taskTitle(a)))
  // Een interne aanvraag is alleen wie, wat en wanneer: event, types, design en website bestaan er niet.
  const rijen: [string, string][] = intern
    ? [
      ['Soort', 'Intern'],
      ['Locatie', escapeHtml(locatieLabel(a.locatie))],
      ['Aanvrager', escapeHtml(a.naam)],
      ['Deadline', deadlineTekst(a.deadline)],
      ['Spoed', spoedTekst(m.spoed)],
    ]
    : [
      ['Locatie', escapeHtml(locatieLabel(a.locatie))],
      ['Aanvrager', escapeHtml(a.naam)],
      ['Event', escapeHtml(a.event)],
      ['Eventdatum', a.event_datum ? escapeHtml(datumLang(a.event_datum)) : leegOf('')],
      ['Deadline', deadlineTekst(a.deadline)],
      ['Aanvraag', escapeHtml(describeRequestTypes(a.aanvraag_types, a.anders_tekst))],
      ['Design', leegOf(DESIGN_MODES.find((d) => d.key === a.design_modus)?.label ?? a.design_modus ?? '')],
      ['Spoed', spoedTekst(m.spoed)],
      ['Website', leegOf(a.website, a.website ? link(a.website, thema) : '')],
      ['Schijf', leegOf(a.schijf_locatie)],
    ]
  if (m.bijlagen.length) rijen.push(['Meegestuurd', escapeHtml(m.bijlagen.join(', '))])
  delen.push(gegevensTabel(rijen))

  if (a.omschrijving) delen.push(kopje(intern ? 'Wat er gevraagd wordt' : 'Wensen en bijzonderheden'), citaat(a.omschrijving, thema))
  // Het menu staat normaal in de Asana-taak. Is die er niet, dan hoort het hier, anders is het weg.
  if (nietInAsana && a.menu_tekst) delen.push(kopje('Menu'), citaat(a.menu_tekst, thema))

  if (m.asanaUrl) delen.push(knop(m.asanaUrl, 'Open de taak in Asana', thema))
  // Zonder taak is het id de enige manier om de aanvraag in Supabase terug te vinden.
  else delen.push(`<p style="margin:20px 0 0;font-size:12px;color:#828b8d;">Aanvraag ${escapeHtml(m.aanvraagId)}</p>`)

  return {
    aan: [ontvangerVoor(a.locatie)],
    onderwerp: onderwerp('Nieuwe aanvraag', {
      spoed: m.spoed,
      nietInAsana,
      soort: a.soort,
      event: a.event,
      eventDatum: a.event_datum,
      types: describeRequestTypes(a.aanvraag_types, a.anders_tekst),
      omschrijving: a.omschrijving,
    }),
    html: mailOpmaak(`Nieuwe ${intern ? 'interne aanvraag' : 'designaanvraag'} van ${a.naam}`, delen.join('\n'), undefined, thema),
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
    soort: Soort
    /** Leeg bij een interne aanvraag. */
    event: string
    /** Bij een interne aanvraag de hele vraag; daar staat het begin van in het onderwerp. */
    omschrijving: string
    spoed: boolean
    /** Na deze aanvulling, dus met een eventueel nieuwe datum. Null bij een interne aanvraag. */
    eventDatum: string | null
    /** Null bij een interne aanvraag zonder deadline. */
    deadline: string | null
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
  /** Gezet als de reactie niet in Asana terechtkwam. */
  asanaFout: string | null
}

export function renderAanvullingMail(m: AanvullingMail): MailBericht {
  const a = m.aanvraag
  const thema = themaVoor(a.locatie)
  const delen: string[] = []

  if (m.asanaFout) {
    delen.push(waarschuwingBlok(
      `<strong>Deze aanvulling staat niet in Asana.</strong> ${escapeHtml(m.asanaFout)}<br>`
        + 'Alles staat hieronder, zodat er niets verloren gaat. Zet het met de hand bij de taak.',
    ))
  }
  if (m.heropend) {
    delen.push(waarschuwingBlok('<strong>Deze taak was al afgerond en is heropend.</strong> Hij staat nu in de kolom Feedback, zonder planningsdatum.'))
  }

  delen.push(taakRegel(m.taakNaam))
  delen.push(`<p style="margin:0;font-weight:bold;">Aanvulling van ${escapeHtml(m.naam)}</p>`, citaat(m.toelichting, thema))

  const gewijzigd = ` <span style="color:${thema.link};font-weight:bold;">(gewijzigd)</span>`
  const rijen: [string, string][] = []
  if (a.soort === 'intern') rijen.push(['Soort', 'Intern'])
  rijen.push(['Locatie', escapeHtml(locatieLabel(a.locatie))], ['Aanvrager', escapeHtml(a.naam)])
  if (a.soort !== 'intern') {
    rijen.push(
      ['Event', escapeHtml(a.event)],
      ['Eventdatum', (a.eventDatum ? escapeHtml(datumLang(a.eventDatum)) : leegOf('')) + (a.eventDatumGewijzigd ? gewijzigd : '')],
    )
  }
  rijen.push(['Deadline', deadlineTekst(a.deadline) + (a.deadlineGewijzigd ? gewijzigd : '')])
  if (a.types.length) rijen.push(['Aanvraag', escapeHtml(describeRequestTypes(a.types, m.andersTekst))])
  if (m.extraTypes.length) rijen.push(['Erbij gevraagd', `<strong>${escapeHtml(describeRequestTypes(m.extraTypes, m.andersTekst))}</strong>`])
  rijen.push(['Spoed', spoedTekst(a.spoed)])
  if (m.link) rijen.push(['Materiaal', link(m.link, thema)])
  if (m.schijfLocatie) rijen.push(['Schijf', escapeHtml(m.schijfLocatie)])
  if (m.bijlagen.length) rijen.push(['Meegestuurd', escapeHtml(m.bijlagen.join(', '))])
  if (m.bijgewerkt.length) rijen.push(['Bijgewerkt in Asana', escapeHtml(m.bijgewerkt.join(', '))])
  delen.push(ruimte(gegevensTabel(rijen), 20))

  if (m.asanaUrl) delen.push(knop(m.asanaUrl, 'Open de taak in Asana', thema))

  return {
    aan: [ontvangerVoor(a.locatie)],
    onderwerp: onderwerp('Aanvulling', {
      spoed: a.spoed,
      nietInAsana: Boolean(m.asanaFout),
      soort: a.soort,
      event: a.event,
      eventDatum: a.eventDatum,
      types: describeRequestTypes(a.types, m.andersTekst),
      omschrijving: a.omschrijving,
    }),
    html: mailOpmaak(`Aanvulling van ${m.naam}`, delen.join('\n'), undefined, thema),
  }
}
