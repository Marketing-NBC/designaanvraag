/**
 * De mails aan collega's (niet aan Marketing) rond een nieuwe aanvraag:
 *
 *  - de bevestiging aan de aanvrager: je aanvraag is binnen, dit staat erin, zo gaat het verder;
 *  - de koppelmail aan collega's die gekoppeld zijn: <naam> heeft je aan deze aanvraag gekoppeld.
 *
 * Puur: gegevens erin, onderwerp en HTML eruit. Adressen opzoeken en versturen doen de edge
 * functions. De adressen komen uit de tabel collegas; een collega zonder adres krijgt niets.
 */
import type { Aanvraag } from './aanvraag-schema.ts'
import { eventEnDatum, kortVan } from './asana-title.ts'
import { aanvullenUrl } from './contact.ts'
import { citaat, escapeHtml, gegevensTabel, knop, mailOpmaak, ruimte, themaVoor } from './mail.ts'
import type { MailBericht } from './mail.ts'
import { datumLang } from './meldingen.ts'
import { describeRequestTypes, locatieLabel } from './request-types.ts'

/** Wat deze mails van een aanvraag nodig hebben; een aanvulling heeft niet de hele aanvraag bij de hand. */
export type AanvraagKern = Pick<Aanvraag,
  'locatie' | 'naam' | 'soort' | 'event' | 'event_datum' | 'deadline' | 'aanvraag_types' | 'anders_tekst' | 'omschrijving' | 'gekoppelden'
> & { menu_taal?: 'nl' | 'en' }

/** "Piet", "Piet en Kees", "Piet, Kees en Bo". */
export function opsomming(namen: string[]): string {
  if (namen.length <= 1) return namen.join('')
  return `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`
}

/** "EY - 11 december - Torenscherm", of bij intern "Intern - Nieuwe visitekaartjes…". */
function waarover(a: Pick<AanvraagKern, 'soort' | 'event' | 'event_datum' | 'omschrijving' | 'aanvraag_types' | 'anders_tekst'>): string {
  if (a.soort === 'intern') return ['Intern', kortVan(a.omschrijving)].filter(Boolean).join(' - ')
  return [...eventEnDatum(a.event, a.event_datum), describeRequestTypes(a.aanvraag_types, a.anders_tekst)].filter(Boolean).join(' - ')
}

/** De gegevens van de aanvraag als tabel; dezelfde voor de aanvrager en voor wie gekoppeld is. */
function gegevens(a: AanvraagKern, menuPakket: string | null): string {
  const rijen: [string, string][] = [['Locatie', escapeHtml(locatieLabel(a.locatie))], ['Aanvrager', escapeHtml(a.naam)]]
  if (a.soort === 'intern') {
    rijen.push(['Soort', 'Intern'])
  } else {
    rijen.push(['Event', escapeHtml(a.event)])
    if (a.event_datum) rijen.push(['Eventdatum', escapeHtml(datumLang(a.event_datum))])
    rijen.push(['Aanvraag', escapeHtml(describeRequestTypes(a.aanvraag_types, a.anders_tekst))])
    if (menuPakket) rijen.push(['Menu', escapeHtml(`${menuPakket}${a.menu_taal === 'en' ? ', in het Engels' : ''}`)])
  }
  rijen.push(['Nodig op', a.deadline ? `<strong>${escapeHtml(datumLang(a.deadline))}</strong>` : 'Geen deadline'])
  if (a.gekoppelden.length) rijen.push(['Ook op de hoogte', escapeHtml(opsomming(a.gekoppelden))])
  return gegevensTabel(rijen)
}

/** Zo gaat het verder: voor iedereen hetzelfde, want gekoppelde collega's mogen ook akkoord geven. */
function verloop(): string {
  return `<p style="margin:24px 0 4px;font-weight:bold;">Hoe gaat het verder?</p>`
    + `<p style="margin:0;">Marketing plant je aanvraag in. Is het ontwerp klaar, dan krijg je een mail met de bestanden. `
    + `Is het goed, geef dan akkoord via de knop in die mail; wil je iets anders, geef dan feedback. `
    + `Tot dat gebeurt krijg je elke werkdag een herinnering.</p>`
}

export interface BevestigingMail {
  aanvraag: AanvraagKern
  aanvraagId: string
  /** Het adres van de aanvrager, uit de tabel collegas. */
  aan: string
  /** Waar een antwoord heen gaat: het marketingpostvak van de locatie. */
  antwoordAan: string
  /** De naam van het pakket ("Standard Lunch"), als er een menu bij hoort. */
  menuPakket?: string | null
  /** Gekoppelde collega's zonder mailadres: die krijgen niets, en dat zeggen we erbij. */
  zonderAdres?: string[]
}

/** "Je aanvraag is binnen": de bevestiging aan wie de aanvraag deed. */
export function renderBevestigingMail(m: BevestigingMail): MailBericht {
  const a = m.aanvraag
  const thema = themaVoor(a.locatie)
  const delen: string[] = []
  const wat = a.soort === 'intern' ? 'je interne aanvraag' : `je aanvraag voor <strong>${escapeHtml(a.event)}</strong>`
  delen.push(`<p style="margin:0 0 16px;">Hoi ${escapeHtml(a.naam)},</p>`)
  delen.push(`<p style="margin:0 0 16px;">Marketing heeft ${wat} ontvangen. Dit staat erin:</p>`)
  delen.push(gegevens(a, m.menuPakket ?? null))
  if (a.omschrijving) delen.push(ruimte(citaat(a.omschrijving, thema), 12))
  if (a.gekoppelden.length) {
    const zonder = m.zonderAdres ?? []
    delen.push(`<p style="margin:16px 0 0;">${escapeHtml(opsomming(a.gekoppelden))} ${a.gekoppelden.length === 1 ? 'krijgt' : 'krijgen'} deze aanvraag ook in de mail.`
      + (zonder.length ? ` Behalve ${escapeHtml(opsomming(zonder))}: daar heeft Marketing geen mailadres van.` : '')
      + '</p>')
  }
  delen.push(verloop())
  delen.push(`<p style="margin:16px 0 0;">Iets vergeten, of verandert er iets? Vul het aan via de knop. Dan komt het bij deze aanvraag terecht.</p>`)
  delen.push(knop(aanvullenUrl(m.aanvraagId), 'Iets aanvullen of wijzigen', thema))

  return {
    aan: [m.aan],
    antwoordAan: [m.antwoordAan],
    onderwerp: `Ontvangen: ${waarover(a)}`.slice(0, 250),
    html: mailOpmaak('Je aanvraag is binnen', delen.join('\n'), 'Je krijgt deze mail omdat je een aanvraag deed via het designaanvraag-formulier.', thema),
  }
}

export interface KoppelMail {
  aanvraag: AanvraagKern
  aanvraagId: string
  /** De adressen van de collega's die nu gekoppeld zijn. */
  aan: string[]
  antwoordAan: string
  /** Wie hen koppelde: de aanvrager, of wie de aanvulling stuurde. */
  door: string
  menuPakket?: string | null
}

/** "<naam> heeft je gekoppeld": aan collega's die bij een aanvraag horen. */
export function renderKoppelMail(m: KoppelMail): MailBericht {
  const a = m.aanvraag
  const thema = themaVoor(a.locatie)
  const wat = a.soort === 'intern' ? 'een interne aanvraag' : `de aanvraag voor <strong>${escapeHtml(a.event)}</strong>`
  const delen = [
    `<p style="margin:0 0 16px;">Hoi,</p>`,
    `<p style="margin:0 0 16px;">${escapeHtml(m.door)} heeft je gekoppeld aan ${wat}. Je blijft dus op de hoogte: je krijgt de mail als het ontwerp klaar is, en je mag akkoord geven of feedback sturen.</p>`,
    gegevens(a, m.menuPakket ?? null),
  ]
  if (a.omschrijving) delen.push(ruimte(citaat(a.omschrijving, thema), 12))
  delen.push(verloop())
  delen.push(`<p style="margin:16px 0 0;">Moet er iets bij of anders? Dat kan via de knop.</p>`)
  delen.push(knop(aanvullenUrl(m.aanvraagId), 'Iets aanvullen of wijzigen', thema))

  return {
    aan: m.aan,
    antwoordAan: [m.antwoordAan],
    onderwerp: `Gekoppeld: ${waarover(a)}`.slice(0, 250),
    html: mailOpmaak(`${m.door} heeft je gekoppeld`, delen.join('\n'), 'Je krijgt deze mail omdat een collega je aan een designaanvraag koppelde.', thema),
  }
}
