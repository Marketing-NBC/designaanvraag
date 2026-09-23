import { MIN_LEAD_BUSINESS_DAYS, normalizeUrl } from '../../shared/aanvraag-schema'
import { vraagtOmMenu } from '../../shared/request-types'
import { SPOED_WERKDAGEN, werkdagenTotEvent } from '../../shared/spoed'
import { businessDaysUntil, isBeforeToday } from './lib/dates'
import type { Draft } from './state'

export type StepKind = 'naam' | 'text' | 'date' | 'url' | 'multi' | 'single' | 'textarea' | 'files'

/**
 * Wat bepaalt welke stappen er zijn. Losse waarden en geen heel concept, zodat de
 * stappenlijst niet opnieuw berekend wordt bij elke toetsaanslag in een veld.
 */
export interface StapContext {
  /** Er is een menukaart of menuscherm aangevraagd. */
  metMenu: boolean
}

export function stapContext(d: Draft): StapContext {
  return { metMenu: vraagtOmMenu(d.aanvraag_types) }
}

export interface StepDef {
  id: string
  kind: StepKind
  title: string
  help?: string
  /** Fout die doorgaan blokkeert. */
  validate: (d: Draft) => string | null
  /** Zachte waarschuwing, blokkeert niet. */
  warn?: (d: Draft) => string | null
  /** Schouderklopje: hetzelfde plekje als `warn`, maar dan omdat het gôed gaat. */
  goed?: (d: Draft) => string | null
  /** Stap alleen tonen als dit klopt. Zonder dit is de stap er altijd. */
  toon?: (ctx: StapContext) => boolean
}

export const STEPS: StepDef[] = [
  {
    id: 'naam',
    kind: 'naam',
    title: 'Hoe heet je?',
    help: 'Kies je naam uit de lijst, dan weet Marketing wie de aanvraag stuurde.',
    validate: (d) => (d.naam ? null : 'Kies je naam uit de lijst.'),
  },
  {
    id: 'event',
    kind: 'text',
    title: 'Voor welk event is het?',
    help: 'De naam zoals de opdrachtgever hem gebruikt.',
    validate: (d) => {
      const v = d.event.trim()
      if (v.length < 2) return 'Vul de naam van het event in.'
      if (v.length > 120) return 'Houd het bij maximaal 120 tekens.'
      return null
    },
  },
  {
    id: 'event_datum',
    kind: 'date',
    title: 'Wanneer is het event?',
    help: 'Bij een meerdaags event: de eerste dag.',
    validate: (d) => {
      if (!d.event_datum) return 'Kies de datum van het event.'
      if (isBeforeToday(d.event_datum)) return 'Die datum is al geweest.'
      return null
    },
    // Alleen een compliment als het ruim op tijd is. Is het krap, dan zeggen we hier niets: dat
    // wordt intern als spoedje geregistreerd, en een waarschuwing hier nodigt vooral uit om met
    // datums te gaan schuiven.
    goed: (d) => {
      if (!d.event_datum || isBeforeToday(d.event_datum)) return null
      const werkdagen = werkdagenTotEvent(d.event_datum)
      if (!Number.isFinite(werkdagen) || werkdagen < SPOED_WERKDAGEN) return null
      return `Fijn dat je er op tijd bij bent: nog ${werkdagen} werkdagen tot het event. Daar kan Marketing goed mee vooruit.`
    },
  },
  {
    id: 'deadline',
    kind: 'date',
    title: 'Wanneer heb je het uiterlijk nodig?',
    help: 'De dag waarop het design klaar moet zijn.',
    validate: (d) => {
      if (!d.deadline) return 'Kies de datum waarop je het nodig hebt.'
      if (isBeforeToday(d.deadline)) return 'Die datum is al geweest.'
      if (d.event_datum && d.deadline > d.event_datum) return 'De deadline kan niet na het event liggen.'
      return null
    },
    warn: (d) => {
      if (!d.deadline) return null
      const days = businessDaysUntil(d.deadline)
      if (days < MIN_LEAD_BUSINESS_DAYS) {
        return `Marketing heeft normaal ${MIN_LEAD_BUSINESS_DAYS} werkdagen nodig; dit zijn er ${Math.max(0, days)}. Overleg even met het team als het sneller moet.`
      }
      return null
    },
  },
  {
    id: 'website',
    kind: 'url',
    title: 'Wat is de website van het bedrijf of het event?',
    help: 'We halen hier automatisch het logo, de kleuren en de fonts vandaan. Is er geen website? Laat het veld dan leeg.',
    validate: (d) => (!d.website.trim() || normalizeUrl(d.website) ? null : 'Vul een geldige website in, bijvoorbeeld www.event.nl.'),
  },
  {
    id: 'schijf_locatie',
    kind: 'text',
    title: 'Waar op de schijf vind ik meer informatie of bestaande designs?',
    help: 'Plak de map op de G:\\-schijf of een link. Mag leeg blijven.',
    validate: (d) => (d.schijf_locatie.length > 500 ? 'Houd het bij maximaal 500 tekens.' : null),
  },
  {
    id: 'bijlagen',
    kind: 'files',
    title: 'Heb je bestanden voor me?',
    help: 'Een logo, voorbeelden, een briefing. Afbeeldingen, PDF, Word of PowerPoint. Mag leeg blijven.',
    // Uploaden gebeurt al tijdens het kiezen; doorgaan mag pas als dat af is, anders zou de aanvraag
    // vertrekken zonder de bestanden waar hij naar verwijst.
    validate: (d) => (d.bijlagen.some((b) => b.status === 'wacht' || b.status === 'bezig') ? 'Je bestanden worden nog geüpload — nog heel even.' : null),
    warn: (d) => {
      const mislukt = d.bijlagen.filter((b) => b.status === 'fout')
      if (!mislukt.length) return null
      return `${mislukt.length === 1 ? 'Dit bestand gaat niet mee' : `${mislukt.length} bestanden gaan niet mee`}: ${mislukt.map((b) => b.bestandsnaam).join(', ')}. Je kunt gewoon doorgaan.`
    },
    goed: (d) => {
      const klaar = d.bijlagen.filter((b) => b.status === 'klaar')
      if (!klaar.length) return null
      return `${klaar.length === 1 ? 'Eén bestand staat klaar' : `${klaar.length} bestanden staan klaar`} om mee te sturen.`
    },
  },
  {
    id: 'aanvraag_types',
    kind: 'multi',
    title: 'Wat wil je aanvragen?',
    help: 'Kies alles wat van toepassing is.',
    validate: (d) => {
      if (d.aanvraag_types.length === 0) return 'Kies minimaal één optie.'
      if (d.aanvraag_types.includes('anders') && !d.anders_tekst.trim()) return 'Vul in wat je bij "Anders" bedoelt.'
      return null
    },
  },
  {
    id: 'menu_tekst',
    kind: 'textarea',
    // Komt meteen na "Wat wil je aanvragen?", want het hoort bij die keuze.
    toon: (ctx) => ctx.metMenu,
    title: 'Wat is de culinaire invulling?',
    help: 'Plak het menu zoals je het van de opdrachtgever kreeg: een kopje per gang, '
      + 'daaronder de gerechten met een bolletje ervoor. Achter een streepje (|) komen de '
      + 'ingredienten. Marketing maakt hier het menuscherm van.',
    validate: (d) => {
      if (!vraagtOmMenu(d.aanvraag_types)) return null
      if (!d.menu_tekst.trim()) return 'Plak de invulling van het menu.'
      if (d.menu_tekst.length > 8000) return 'Houd het bij maximaal 8000 tekens.'
      return null
    },
  },
  {
    id: 'design_modus',
    kind: 'single',
    title: 'Volledig custom of standaard designs?',
    validate: (d) => (d.design_modus ? null : 'Maak een keuze.'),
  },
  {
    id: 'omschrijving',
    kind: 'textarea',
    title: 'Omschrijf je wensen of bijzonderheden',
    help: 'Teksten, sfeer, voorbeelden, formaten, dingen die Marketing moet weten. Mag leeg blijven.',
    validate: (d) => (d.omschrijving.length > 3000 ? 'Houd het bij maximaal 3000 tekens.' : null),
  },
]

/**
 * De stappen die deze aanvraag echt doorloopt. Een stap met `toon` valt weg als
 * die niet van toepassing is; wie geen menukaart of menuscherm aanvraagt, krijgt
 * de vraag over het menu dus niet te zien.
 */
export function zichtbareStappen(ctx: StapContext): StepDef[] {
  return STEPS.filter((s) => !s.toon || s.toon(ctx))
}
