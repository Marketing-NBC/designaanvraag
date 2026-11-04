/**
 * De bevestiging aan wie een aanvraag doet: je aanvraag is binnen, dit staat erin, zo gaat het
 * verder. Puur: gegevens erin, onderwerp en HTML eruit. Het adres opzoeken en versturen doet de
 * function submit-aanvraag; het adres komt uit de tabel collegas.
 */
import type { Aanvraag } from './aanvraag-schema.ts'
import { eventEnDatum, kortVan } from './asana-title.ts'
import { aanvullenUrl } from './contact.ts'
import { citaat, escapeHtml, gegevensTabel, knop, mailOpmaak, ruimte, themaVoor } from './mail.ts'
import type { MailBericht } from './mail.ts'
import { datumLang } from './meldingen.ts'
import { describeRequestTypes, locatieLabel } from './request-types.ts'

/** "Piet", "Piet en Kees", "Piet, Kees en Bo". */
export function opsomming(namen: string[]): string {
  if (namen.length <= 1) return namen.join('')
  return `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`
}

/** "EY - 11 december - Torenscherm", of bij intern "Intern - Nieuwe visitekaartjes…". */
function waarover(a: Aanvraag): string {
  if (a.soort === 'intern') return ['Intern', kortVan(a.omschrijving)].filter(Boolean).join(' - ')
  return [...eventEnDatum(a.event, a.event_datum), describeRequestTypes(a.aanvraag_types, a.anders_tekst)].filter(Boolean).join(' - ')
}

export interface BevestigingMail {
  aanvraag: Aanvraag
  aanvraagId: string
  /** Het adres van de aanvrager, uit de tabel collegas. */
  aan: string
  /** Waar een antwoord heen gaat: het marketingpostvak van de locatie. */
  antwoordAan: string
  /** De naam van het pakket ("Standard Lunch"), als er een menu bij hoort. */
  menuPakket?: string | null
}

/** "Je aanvraag is binnen": de bevestiging aan wie de aanvraag deed. */
export function renderBevestigingMail(m: BevestigingMail): MailBericht {
  const a = m.aanvraag
  const thema = themaVoor(a.locatie)
  const wat = a.soort === 'intern' ? 'je interne aanvraag' : `je aanvraag voor <strong>${escapeHtml(a.event)}</strong>`

  const rijen: [string, string][] = [['Locatie', escapeHtml(locatieLabel(a.locatie))], ['Aanvrager', escapeHtml(a.naam)]]
  if (a.soort === 'intern') {
    rijen.push(['Soort', 'Intern'])
  } else {
    rijen.push(['Event', escapeHtml(a.event)])
    if (a.event_datum) rijen.push(['Eventdatum', escapeHtml(datumLang(a.event_datum))])
    rijen.push(['Aanvraag', escapeHtml(describeRequestTypes(a.aanvraag_types, a.anders_tekst))])
    if (m.menuPakket) rijen.push(['Menu', escapeHtml(`${m.menuPakket}${a.menu_taal === 'en' ? ', in het Engels' : ''}`)])
  }
  rijen.push(['Nodig op', a.deadline ? `<strong>${escapeHtml(datumLang(a.deadline))}</strong>` : 'Geen deadline'])

  const delen = [
    `<p style="margin:0 0 16px;">Hoi ${escapeHtml(a.naam)},</p>`,
    `<p style="margin:0 0 16px;">Marketing heeft ${wat} ontvangen. Dit staat erin:</p>`,
    gegevensTabel(rijen),
  ]
  if (a.omschrijving) delen.push(ruimte(citaat(a.omschrijving, thema), 12))
  delen.push(`<p style="margin:24px 0 4px;font-weight:bold;">Hoe gaat het verder?</p>`
    + `<p style="margin:0;">Marketing plant je aanvraag in. Is het ontwerp klaar, dan krijg je een mail met de bestanden. `
    + `Is het goed, geef dan akkoord via de knop in die mail; wil je iets anders, geef dan feedback. `
    + `Tot dat gebeurt krijg je elke werkdag een herinnering.</p>`)
  delen.push(`<p style="margin:16px 0 0;">Iets vergeten, of verandert er iets? Vul het aan via de knop. Dan komt het bij deze aanvraag terecht.</p>`)
  delen.push(knop(aanvullenUrl(m.aanvraagId), 'Iets aanvullen of wijzigen', thema))

  return {
    aan: [m.aan],
    antwoordAan: [m.antwoordAan],
    onderwerp: `Ontvangen: ${waarover(a)}`.slice(0, 250),
    html: mailOpmaak('Je aanvraag is binnen', delen.join('\n'), 'Je krijgt deze mail omdat je een aanvraag deed via het designaanvraag-formulier.', thema),
  }
}
