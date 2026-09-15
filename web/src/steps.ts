import { MIN_LEAD_BUSINESS_DAYS, normalizeUrl } from '../../shared/aanvraag-schema'
import { SPOED_WERKDAGEN, werkdagenTotEvent } from '../../shared/spoed'
import { businessDaysUntil, isBeforeToday } from './lib/dates'
import type { Draft } from './state'

export type StepKind = 'naam' | 'text' | 'date' | 'url' | 'multi' | 'single' | 'textarea'

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
}

export const STEPS: StepDef[] = [
  {
    id: 'naam',
    kind: 'naam',
    title: 'Hoe heet je?',
    help: 'Kies je naam uit de lijst, dan weet Marketing wie ze kunnen bellen.',
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
