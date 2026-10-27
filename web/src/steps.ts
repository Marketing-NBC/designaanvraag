import { MIN_LEAD_BUSINESS_DAYS, normalizeUrl } from '../../shared/aanvraag-schema'
import { vraagtOmMenu, type Soort } from '../../shared/request-types'
import { MELDING_ONTVANGERS } from '../../shared/contact'
import { SPOED_WERKDAGEN, werkdagenTotEvent } from '../../shared/spoed'
import { businessDaysUntil, isBeforeToday } from './lib/dates'
import { aantalGerechten, eigenGerechten } from './lib/menu'
import type { Draft } from './state'

export type StepKind = 'locatie' | 'naam' | 'soort' | 'text' | 'date' | 'url' | 'multi' | 'single' | 'textarea' | 'files' | 'menu'

/**
 * Wat bepaalt welke stappen er zijn. Losse waarden en geen heel concept, zodat de
 * stappenlijst niet opnieuw berekend wordt bij elke toetsaanslag in een veld.
 */
export interface StapContext {
  /** Er is een menukaart of menuscherm aangevraagd. */
  metMenu: boolean
  /**
   * Evenement of intern. Zolang er nog niet gekozen is tellen we de vragen van een evenement:
   * dat is de lange route, en het startscherm belooft liever te veel dan te weinig.
   */
  soort: Soort | null
}

export function stapContext(d: Draft): StapContext {
  return { metMenu: vraagtOmMenu(d.aanvraag_types), soort: d.soort }
}

const isIntern = (ctx: StapContext) => ctx.soort === 'intern'
const isEvenement = (ctx: StapContext) => ctx.soort !== 'intern'

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
  /** Dringender dan `warn`: het is zo krap dat de collega na het versturen contact moet opnemen. */
  alarm?: (d: Draft) => string | null
  /** Stap alleen tonen als dit klopt. Zonder dit is de stap er altijd. */
  toon?: (ctx: StapContext) => boolean
}

/**
 * Zoveel werkdagen of minder en het is te krap om zonder overleg te beloven: de collega moet na het
 * versturen even contact opnemen met Marketing. Geldt voor het event en voor de deadline.
 */
export const KRAP_WERKDAGEN = 3

/** Werkdagen tot de deadline, of null als die er (nog) niet is. */
function werkdagenTotDeadline(deadline: string | null): number | null {
  if (!deadline || isBeforeToday(deadline)) return null
  return Math.max(0, businessDaysUntil(deadline))
}

/** Werkdagen tot het event, of null als dat er (nog) niet is. */
function werkdagenTotEventdatum(eventDatum: string | null): number | null {
  if (!eventDatum || isBeforeToday(eventDatum)) return null
  const n = werkdagenTotEvent(eventDatum)
  return Number.isFinite(n) ? n : null
}

/** "dit is er 1", "dit zijn er 3"; bij nul "er zit geen werkdag meer tussen". */
function ditZijnEr(n: number): string {
  if (n <= 0) return 'er zit geen werkdag meer tussen'
  return n === 1 ? 'dit is er 1' : `dit zijn er ${n}`
}

/** Het postvak van Marketing voor deze locatie; Green Village heeft een eigen. */
function marketingMail(d: Draft): string {
  return MELDING_ONTVANGERS[d.locatie ?? 'nbc']
}

/** Te weinig tijd voor Marketing: een zachte waarschuwing, geen blokkade. */
function deadlineWaarschuwing(deadline: string | null): string | null {
  const days = werkdagenTotDeadline(deadline)
  if (days === null || days <= KRAP_WERKDAGEN || days >= MIN_LEAD_BUSINESS_DAYS) return null
  return `Marketing heeft normaal ${MIN_LEAD_BUSINESS_DAYS} werkdagen nodig; ${ditZijnEr(days)}. Overleg even met het team als het sneller moet.`
}

/** Zo krap dat we niets kunnen beloven: na het versturen moet er contact worden opgenomen. */
function deadlineAlarm(d: Draft): string | null {
  const days = werkdagenTotDeadline(d.deadline)
  if (days === null || days > KRAP_WERKDAGEN) return null
  return `Marketing heeft normaal ${MIN_LEAD_BUSINESS_DAYS} werkdagen nodig; ${ditZijnEr(days)}. `
    + 'We kunnen dan niet beloven dat het op tijd klaar is. Verstuur je aanvraag en neem daarna meteen even contact op '
    + `met het marketingteam (${marketingMail(d)}).`
}

/**
 * Moet de collega na het versturen contact opnemen met Marketing? Dat is zo als het event of de
 * deadline binnen KRAP_WERKDAGEN valt. Het bedankscherm herhaalt het dan nog een keer.
 */
export function moetContactOpnemen(d: Draft): boolean {
  const event = d.soort === 'intern' ? null : werkdagenTotEventdatum(d.event_datum)
  const deadline = werkdagenTotDeadline(d.deadline)
  return (event !== null && event <= KRAP_WERKDAGEN) || (deadline !== null && deadline <= KRAP_WERKDAGEN)
}

export const STEPS: StepDef[] = [
  {
    id: 'locatie',
    kind: 'locatie',
    title: 'Voor welke locatie is het?',
    help: 'NBC en Green Village hebben niet dezelfde schermen, dus dit bepaalt wat je hierna kunt kiezen.',
    validate: (d) => (d.locatie ? null : 'Kies een locatie.'),
  },
  {
    id: 'naam',
    kind: 'naam',
    title: 'Hoe heet je?',
    help: 'Kies je naam uit de lijst. Sta je er niet tussen? Typ dan gewoon je naam.',
    validate: (d) => {
      const v = d.naam.trim()
      if (v.length < 2) return 'Vul je naam in.'
      if (v.length > 80) return 'Houd het bij maximaal 80 tekens.'
      return null
    },
  },
  {
    id: 'soort',
    kind: 'soort',
    title: 'Is het voor een evenement of intern?',
    help: 'Voor een evenement vragen we naar het event. Voor iets intern alleen wat je nodig hebt en wanneer.',
    validate: (d) => (d.soort ? null : 'Maak een keuze.'),
  },
  // ── Intern: twee vragen en dan het overzicht ──────────────────────────────
  {
    id: 'wens_intern',
    kind: 'textarea',
    toon: isIntern,
    title: 'Wat wil je aanvragen?',
    help: 'Beschrijf alles wat Marketing moet weten: wat het is, formaat, teksten, voor wie.',
    validate: (d) => {
      const v = d.omschrijving.trim()
      if (v.length < 5) return 'Beschrijf wat je wilt aanvragen.'
      if (v.length > 3000) return 'Houd het bij maximaal 3000 tekens.'
      return null
    },
  },
  {
    id: 'deadline_intern',
    kind: 'date',
    toon: isIntern,
    title: 'Wanneer heb je het nodig?',
    help: 'De dag waarop het klaar moet zijn.',
    validate: (d) => {
      if (!d.deadline) return 'Kies de datum waarop je het nodig hebt.'
      if (isBeforeToday(d.deadline)) return 'Die datum is al geweest.'
      return null
    },
    warn: (d) => deadlineWaarschuwing(d.deadline),
    alarm: deadlineAlarm,
  },
  // ── Evenement ────────────────────────────────────────────────────────────
  {
    id: 'event',
    kind: 'text',
    toon: isEvenement,
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
    toon: isEvenement,
    title: 'Wanneer is het event?',
    help: 'Bij een meerdaags event: de eerste dag.',
    validate: (d) => {
      if (!d.event_datum) return 'Kies de datum van het event.'
      if (isBeforeToday(d.event_datum)) return 'Die datum is al geweest.'
      return null
    },
    // Ruim op tijd: een compliment. Minder dan twee weken (een spoedje): drukwerk dat we moeten
    // bestellen haalt het dan waarschijnlijk niet. Binnen een paar werkdagen: na het versturen
    // contact opnemen, want dan moet er overlegd worden wat er nog kan.
    goed: (d) => {
      const werkdagen = werkdagenTotEventdatum(d.event_datum)
      if (werkdagen === null || werkdagen < SPOED_WERKDAGEN) return null
      return `Fijn dat je er op tijd bij bent: nog ${werkdagen} werkdagen tot het event. Daar kan Marketing goed mee vooruit.`
    },
    warn: (d) => {
      const werkdagen = werkdagenTotEventdatum(d.event_datum)
      if (werkdagen === null || werkdagen <= KRAP_WERKDAGEN || werkdagen >= SPOED_WERKDAGEN) return null
      return 'Het event is over minder dan twee weken. Drukwerk dat we moeten bestellen, zoals een geprinte menukaart, '
        + 'is dan waarschijnlijk niet meer op tijd te krijgen.'
    },
    alarm: (d) => {
      const werkdagen = werkdagenTotEventdatum(d.event_datum)
      if (werkdagen === null || werkdagen > KRAP_WERKDAGEN) return null
      return 'Het event is al over een paar dagen. Drukwerk dat we moeten bestellen lukt dan niet meer. '
        + `Vul het formulier gewoon in en neem daarna meteen even contact op met het marketingteam (${marketingMail(d)}) `
        + 'om te bespreken wat er precies gedaan moet worden.'
    },
  },
  {
    id: 'deadline',
    kind: 'date',
    toon: isEvenement,
    title: 'Wanneer heb je het uiterlijk nodig?',
    help: 'De dag waarop het design klaar moet zijn.',
    validate: (d) => {
      if (!d.deadline) return 'Kies de datum waarop je het nodig hebt.'
      if (isBeforeToday(d.deadline)) return 'Die datum is al geweest.'
      if (d.event_datum && d.deadline > d.event_datum) return 'De deadline kan niet na het event liggen.'
      return null
    },
    warn: (d) => deadlineWaarschuwing(d.deadline),
    alarm: deadlineAlarm,
  },
  {
    id: 'website',
    kind: 'url',
    toon: isEvenement,
    title: 'Wat is de website van het bedrijf of het event?',
    help: 'We halen hier automatisch het logo, de kleuren en de fonts vandaan. Is er geen website? Laat het veld dan leeg.',
    validate: (d) => (!d.website.trim() || normalizeUrl(d.website) ? null : 'Vul een geldige website in, bijvoorbeeld www.event.nl.'),
  },
  {
    id: 'schijf_locatie',
    kind: 'text',
    toon: isEvenement,
    title: 'Waar op de schijf vind ik meer informatie of bestaande designs?',
    help: 'Plak de map op de G:\\-schijf of een link. Mag leeg blijven.',
    validate: (d) => (d.schijf_locatie.length > 500 ? 'Houd het bij maximaal 500 tekens.' : null),
  },
  {
    id: 'bijlagen',
    kind: 'files',
    toon: isEvenement,
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
    toon: isEvenement,
    title: 'Wat wil je aanvragen?',
    help: 'Kies alles wat van toepassing is.',
    validate: (d) => {
      if (d.aanvraag_types.length === 0) return 'Kies minimaal één optie.'
      if (d.aanvraag_types.includes('anders') && !d.anders_tekst.trim()) return 'Vul in wat je bij "Anders" bedoelt.'
      return null
    },
    // Een geprinte menukaart moeten we bestellen. Ligt de deadline minder dan twee weken weg, dan
    // zeggen we het hier nog een keer, ook als het al bij de eventdatum stond.
    warn: (d) => {
      if (!d.aanvraag_types.includes('menukaart_print')) return null
      const datum = d.deadline ?? d.event_datum
      if (!datum || isBeforeToday(datum)) return null
      if (werkdagenTotEvent(datum) >= SPOED_WERKDAGEN) return null
      return 'De deadline ligt minder dan twee weken weg. Een geprinte menukaart moeten we laten drukken, '
        + 'dus we kunnen niet garanderen dat die op tijd klaar is.'
    },
  },
  {
    id: 'menu',
    kind: 'menu',
    // Komt meteen na "Wat wil je aanvragen?", want het hoort bij die keuze.
    toon: (ctx) => isEvenement(ctx) && ctx.metMenu,
    title: 'Welk pakket is het?',
    help: 'Kies het pakket; je ziet daarna wat erin zit en kunt gerechten weghalen, '
      + 'wisselen of toevoegen.',
    validate: (d) => {
      if (!vraagtOmMenu(d.aanvraag_types)) return null
      if (!d.menu.pakket) return 'Kies een pakket.'
      if (!aantalGerechten(d.menu)) return 'Er staat geen enkel gerecht meer in het menu.'
      return null
    },
    // Een gerecht dat niet in het repertoire staat mag, maar Marketing moet er even
    // naar kijken: de opmaak is dan niet die van de ontwerper.
    warn: (d) => {
      const eigen = eigenGerechten(d.menu)
      if (!eigen.length) return null
      return eigen.length === 1
        ? `"${eigen[0]}" staat niet in de gerechtenlijst. Marketing kijkt daarnaar.`
        : `${eigen.length} gerechten staan niet in de gerechtenlijst. Marketing kijkt daarnaar.`
    },
  },
  {
    id: 'design_modus',
    kind: 'single',
    toon: isEvenement,
    title: 'Standaard designs of volledig custom?',
    validate: (d) => (d.design_modus ? null : 'Maak een keuze.'),
  },
  {
    id: 'omschrijving',
    kind: 'textarea',
    toon: isEvenement,
    title: 'Omschrijf je wensen of bijzonderheden',
    // De regelovergang is bedoeld: wat erin kan staan is iets anders dan de mededeling
    // dat het leeg mag. Een \n in een help-tekst komt als regelovergang op het scherm.
    help: 'Teksten, sfeer, voorbeelden, formaten, dingen die Marketing moet weten.\nMag leeg blijven.',
    validate: (d) => (d.omschrijving.length > 3000 ? 'Houd het bij maximaal 3000 tekens.' : null),
  },
]

/**
 * De stappen die deze aanvraag echt doorloopt. Een stap met `toon` valt weg als
 * die niet van toepassing is; wie geen menukaart of menuscherm aanvraagt, krijgt
 * de vraag over het menu dus niet te zien, en wie intern kiest slaat alle vragen
 * over het event over.
 */
export function zichtbareStappen(ctx: StapContext): StepDef[] {
  return STEPS.filter((s) => !s.toon || s.toon(ctx))
}
