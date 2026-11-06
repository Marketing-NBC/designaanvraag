/**
 * Akkoord op een oplevering, en de herinnering zolang dat er niet is.
 *
 * Zo loopt het:
 *  - De opleveringsmail heeft een knop "Akkoord geven". Die opent een scherm in het formulier met
 *    één knop; pas daar wordt het akkoord gegeven. (Een link die bij het openen al akkoord geeft,
 *    gaat af zodra de virusscanner van Outlook hem controleert.)
 *  - Akkoord gaat over de laatst verstuurde versie. Alleen de aanvrager mag het geven; wie de mail
 *    via "Ook mailen naar" kreeg, kan wel feedback geven.
 *  - Na een akkoord gaat de taak in Asana naar de kolom Afgerond, met een reactie wie en wanneer.
 *  - Tot er akkoord of feedback is, krijgt iedereen die de opleveringsmail kreeg (de aanvrager en
 *    wie in "Ook mailen naar" staat) elke werkdag om 9:00 een herinnering (scripts/herinneringen.mjs).
 *    Is de oplevering na 15:00 verstuurd, dan komt de eerste de volgende werkdag pas om 12:00.
 *    Feedback telt pas als hij echt via het formulier is verstuurd, niet als iemand alleen op de
 *    knop klikte.
 *  - Dit alles alleen bij aanvragen van na AKKOORD_VANAF; oudere krijgen de mail zoals vroeger.
 *  - Sleept Marketing de taak zelf naar Afgerond (akkoord gekregen per telefoon, bijvoorbeeld), dan
 *    stoppen de herinneringen ook.
 *
 * Puur: gegevens erin, keuzes en HTML eruit.
 */
import { eventEnDatum, formatDateShortNl, kortVan } from './asana-title.ts'
import { akkoordUrl } from './contact.ts'
import { escapeHtml, gegevensTabel, knop, mailOpmaak, ruimte, themaVoor } from './mail.ts'
import type { MailBericht } from './mail.ts'
import { feedbackUrl } from './oplevering.ts'
import { describeRequestTypes } from './request-types.ts'
import type { Locatie, RequestTypeKey, Soort } from './request-types.ts'
import { vandaagInNl } from './spoed.ts'

/**
 * Akkoord en herinneringen gelden alleen voor aanvragen die zijn ingediend nadat deze functie live
 * ging (4 november 2026, 15:36). Een oudere aanvraag krijgt de opleveringsmail zoals vroeger: met
 * Feedback geven, zonder akkoordknop en zonder herinneringen.
 */
export const AKKOORD_VANAF = '2026-11-04T14:36:52Z'

/** Krijgt een aanvraag die op dit moment is ingediend de akkoordknop en de herinneringen? */
export function metAkkoord(aanvraagCreatedAt: string | null | undefined): boolean {
  const t = Date.parse(aanvraagCreatedAt ?? '')
  return Number.isFinite(t) && t >= Date.parse(AKKOORD_VANAF)
}

/** Maandag tot en met vrijdag. Feestdagen tellen gewoon mee als werkdag. */
export function isWerkdag(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`)
  const dag = d.getUTCDay()
  return Number.isFinite(d.getTime()) && dag >= 1 && dag <= 5
}

/** Wat de herinnering moet weten van een oplevering. */
export interface OpenOplevering {
  verstuurd_op: string | null
  herinneren: boolean
  akkoord_op: string | null
  feedback_op: string | null
  gestopt_op: string | null
  laatste_herinnering: string | null
}

/**
 * Na dit uur (Nederlandse tijd) verstuurd: de eerste herinnering komt de volgende werkdag pas in de
 * ronde van 12:00, niet al om 9:00. Ook na een weekend. Wie om vijf uur 's middags een oplevering krijgt, heeft er de
 * volgende ochtend om negen uur nog nauwelijks naar kunnen kijken.
 */
export const LAAT_VERSTUURD_VANAF_UUR = 15

/** De herinneringen gaan in twee rondes: om 9:00 en om 12:00. */
export type HerinneringRonde = 'ochtend' | 'middag'

/** Het uur (0-23) van een tijdstip in Nederlandse tijd. */
export function uurInNl(moment: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' }).format(moment))
}

/**
 * Krijgt deze oplevering vandaag in deze ronde een herinnering?
 *
 * Alleen op een werkdag, niet op de dag zelf dat hij verstuurd is (dan heeft de mail net in de
 * inbox gestaan), en hooguit één keer per dag, ook als de workflow twee keer draait.
 *
 * De ochtendronde (9:00) slaat de eerste herinnering over van een oplevering die na 15:00 verstuurd
 * is; die komt in de middagronde (12:00). Ook na een weekend: vrijdag om 16:00 verstuurd wordt maandag
 * om 12:00. De middagronde stuurt verder alles wat vandaag nog geen herinnering had, dus ook wat de
 * ochtendronde miste (GitHub viel uit, bijvoorbeeld).
 */
export function herinneringVandaag(o: OpenOplevering, vandaag: string, ronde: HerinneringRonde = 'ochtend'): boolean {
  if (!o.herinneren || !o.verstuurd_op || o.akkoord_op || o.feedback_op || o.gestopt_op) return false
  if (!isWerkdag(vandaag)) return false
  const verstuurd = new Date(o.verstuurd_op)
  if (vandaagInNl(verstuurd) >= vandaag) return false
  if (o.laatste_herinnering && vandaagInNl(new Date(o.laatste_herinnering)) >= vandaag) return false
  if (ronde === 'ochtend' && !o.laatste_herinnering && uurInNl(verstuurd) >= LAAT_VERSTUURD_VANAF_UUR) return false
  return true
}

/** Over welke aanvraag het gaat, in een paar woorden. */
export interface Waarover {
  soort: Soort
  event: string
  eventDatum: string | null
  omschrijving: string
  types: RequestTypeKey[]
  andersTekst: string
}

/** "EY - 11 december - Torenscherm", of bij intern "Intern - Nieuwe visitekaartjes…". */
export function waaroverTekst(w: Waarover): string {
  if (w.soort === 'intern') return ['Intern', kortVan(w.omschrijving)].filter(Boolean).join(' - ')
  return [...eventEnDatum(w.event, w.eventDatum), describeRequestTypes(w.types, w.andersTekst)].filter(Boolean).join(' - ')
}

/** "Het design voor <strong>EY</strong>" of "Je interne aanvraag". */
function hetDesign(w: Waarover): string {
  return w.soort === 'intern' ? 'Je interne aanvraag' : `Het design voor <strong>${escapeHtml(w.event)}</strong>`
}

export interface HerinneringMail extends Waarover {
  aan: string[]
  antwoordAan: string[]
  aanvraagId: string
  locatie: Locatie
  versie: number
  /** Wanneer de oplevering verstuurd is (ISO-tijdstip). */
  verstuurdOp: string
  /** Hoeveelste herinnering dit is; 1 is de eerste. */
  nummer: number
  /** Wie de aanvraag deed: alleen die kan akkoord geven. */
  aanvrager: string
}

/** De herinnering: het staat klaar, geef akkoord of feedback. */
export function renderHerinneringMail(m: HerinneringMail): MailBericht {
  const thema = themaVoor(m.locatie)
  const datum = formatDateShortNl(vandaagInNl(new Date(m.verstuurdOp)))
  const versie = m.versie > 1 ? `Versie ${m.versie} van ${hetDesign(m).charAt(0).toLowerCase()}${hetDesign(m).slice(1)}` : hetDesign(m)
  const delen = [
    `<p style="margin:0 0 16px;">Hoi,</p>`,
    `<p style="margin:0 0 16px;">${versie} staat sinds ${escapeHtml(datum)} klaar en wacht nog op een reactie. `
      + 'Is het goed, geef dan akkoord. Moet er iets anders, geef dan feedback. De bestanden staan in de mail van '
      + `${escapeHtml(datum)}.</p>`,
  ]
  const rijen: [string, string][] = m.soort === 'intern'
    ? [['Aanvraag', escapeHtml(kortVan(m.omschrijving, 120) || 'Interne aanvraag')]]
    : [['Event', escapeHtml(m.event)], ...(m.types.length ? [['Aanvraag', escapeHtml(describeRequestTypes(m.types, m.andersTekst))] as [string, string]] : [])]
  if (m.versie > 1) rijen.push(['Versie', String(m.versie)])
  delen.push(gegevensTabel(rijen))
  // Feedback eerst, akkoord eronder in een eigen kleur: zo staan ze ook in de opleveringsmail.
  delen.push(knop(feedbackUrl(m.aanvraagId), 'Feedback geven', thema))
  delen.push(knop(akkoordUrl(m.aanvraagId), 'Akkoord geven', thema, 'akkoord'))
  delen.push(ruimte(`<p style="margin:0;color:#596165;font-size:13px;">Je krijgt deze herinnering elke werkdag tot er akkoord of feedback is. `
    + `Akkoord geven kan alleen ${escapeHtml(m.aanvrager)}, die de aanvraag deed; feedback geven kan iedereen die deze mail krijgt.</p>`, 16))
  return {
    aan: m.aan,
    antwoordAan: m.antwoordAan,
    onderwerp: `Herinnering: wacht op je akkoord - ${waaroverTekst(m)}`.slice(0, 250),
    html: mailOpmaak('Wacht op je akkoord', delen.join('\n'), 'Herinnering van het designaanvraag-formulier.', thema, 'herinnering'),
  }
}

export interface AkkoordMelding extends Waarover {
  aan: string
  locatie: Locatie
  door: string
  versie: number
  asanaUrl: string | null
  /** Gezet als het in Asana niet lukte; dan moet Marketing het met de hand doen. */
  asanaFout: string | null
}

/** De melding aan Marketing: er is akkoord gegeven. */
export function renderAkkoordMelding(m: AkkoordMelding): MailBericht {
  const thema = themaVoor(m.locatie)
  const delen: string[] = []
  if (m.asanaFout) {
    delen.push(`<p style="margin:0 0 16px;color:#c0392b;"><strong>Niet bijgewerkt in Asana:</strong> ${escapeHtml(m.asanaFout)} Zet de taak met de hand in Afgerond.</p>`)
  }
  delen.push(`<p style="margin:0 0 16px;"><strong>${escapeHtml(m.door)}</strong> gaf akkoord op ${m.versie > 1 ? `versie ${m.versie}` : 'de oplevering'}.`
    + `${m.asanaFout ? '' : ' De taak staat nu in Afgerond.'}</p>`)
  delen.push(gegevensTabel([['Aanvraag', escapeHtml(waaroverTekst(m))], ['Versie', String(m.versie)], ['Akkoord van', escapeHtml(m.door)]]))
  if (m.asanaUrl) delen.push(knop(m.asanaUrl, 'Open de taak in Asana', thema))
  return {
    aan: [m.aan],
    onderwerp: `Akkoord: ${waaroverTekst(m)}`.slice(0, 250),
    html: mailOpmaak(`Akkoord van ${m.door}`, delen.join('\n'), undefined, thema, 'akkoord'),
  }
}

function escapeAsana(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** De reactie in Asana na een akkoord. */
export function verslagAkkoord(v: { door: string; versie: number; datum: string; afgerond: boolean }): string {
  return `<body><strong>Akkoord</strong> van ${escapeAsana(v.door)} op ${v.versie > 1 ? `versie ${v.versie}` : 'de oplevering'}, `
    + `${escapeAsana(formatDateShortNl(v.datum))}, via het formulier.${v.afgerond ? ' De taak staat nu in Afgerond en de herinneringen zijn gestopt.' : ' De herinneringen zijn gestopt.'}</body>`
}

/** Wat het akkoordscherm in het formulier laat zien voordat iemand op de knop drukt. */
export interface AkkoordInfo {
  /** open: er kan akkoord gegeven worden; akkoord: al gegeven; geen_oplevering: er is nog niets verstuurd. */
  status: 'open' | 'akkoord' | 'geen_oplevering'
  soort: Soort
  event: string
  event_datum: string | null
  /** Ingekort, en alleen bij een interne aanvraag. */
  omschrijving: string
  aanvraag_types: RequestTypeKey[]
  anders_tekst: string
  /** Wie de aanvraag deed: alleen die kan akkoord geven. */
  aanvrager: string
  versie: number | null
  verstuurd_op: string | null
  akkoord_op: string | null
  akkoord_door: string | null
}

export interface AkkoordResultaat {
  versie: number
  door: string
  /** Er stond al een akkoord op; dit is dan wie dat gaf. */
  al: boolean
}
