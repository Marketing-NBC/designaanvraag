import type { Aanvraag } from './aanvraag-schema.ts'
import { MENU_TYPES, requestTypeLabel } from './request-types.ts'

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

/**
 * "2026-10-20" → "20 oktober 2026", of met `metJaar: false` → "20 oktober".
 * Puur op de ISO-string, dus zonder tijdzone-verrassingen.
 */
export function formatDateShortNl(iso: string, metJaar = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const maand = MAANDEN[Number(m[2]) - 1] ?? m[2]
  return `${Number(m[3])} ${maand}${metJaar ? ` ${m[1]}` : ''}`
}

/** Hoe een maand in een eventnaam kan staan: voluit, afgekort of in het Engels. */
const MAAND_SCHRIJFWIJZEN: readonly string[][] = [
  ['januari', 'jan', 'january'],
  ['februari', 'feb', 'febr', 'february'],
  ['maart', 'mrt', 'mar', 'march'],
  ['april', 'apr'],
  ['mei', 'may'],
  ['juni', 'jun', 'june'],
  ['juli', 'jul', 'july'],
  ['augustus', 'aug', 'august'],
  ['september', 'sep', 'sept'],
  ['oktober', 'okt', 'oct', 'october'],
  ['november', 'nov'],
  ['december', 'dec'],
]

/**
 * Staat de eventdatum al in de eventnaam? "Zorgcongres 20 november 2026", "Gala 20 nov",
 * "Beurs 19-20 november", "Kick-off 20-11-2026", "Event 2026-11-20". Dan hoeft hij in de
 * taaknaam niet nog eens apart, want twee keer dezelfde datum is lelijk en zegt niets extra.
 *
 * Alleen de dag én de maand van de eventdatum tellen: een jaartal alleen ("Zorgcongres 2026")
 * of een andere datum in de naam is geen reden om de eventdatum weg te laten.
 */
export function eventNaamBevatDatum(event: string, iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return false
  const [jaar, maand, dag] = [m[1], Number(m[2]), Number(m[3])]
  const naam = event.toLowerCase()
  const d = `0?${dag}`
  const mm = `0?${maand}`
  const maandWoord = `(?:${MAAND_SCHRIJFWIJZEN[maand - 1].join('|')})\\.?(?![a-z])`
  // "20 november", "20nov", "20e november", en bij een reeks "20-21 november" of "19 t/m 20 november".
  const reeks = `(?:\\s*(?:-|–|/|&|en|t/m|tot)\\s*\\d{1,2})?`
  const patronen = [
    `(?<!\\d)${d}(?:ste|de|e)?${reeks}\\s*[-.]?\\s*${maandWoord}`,
    `(?<!\\d)\\d{1,2}\\s*(?:-|–|/|&|en|t/m|tot)\\s*${d}(?:ste|de|e)?\\s*${maandWoord}`,
    // "20-11", "20/11/2026", "20.11.26"
    `(?<!\\d)${d}[-/.]${mm}(?![\\d])`,
    // "2026-11-20"
    `${jaar}[-/.]${mm}[-/.]${d}(?!\\d)`,
  ]
  return patronen.some((p) => new RegExp(p).test(naam))
}

const ISO = (j: number, m: number, d: number) => `${j}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Bestaat deze dag echt? 31 februari niet. */
function geldigeDag(j: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(j, m, 0)).getUTCDate()
}

/**
 * Haalt de eventdatum uit de eventnaam, zodat het formulier hem alvast kan aanklikken:
 * "Zorgcongres 20 november 2026" → "2026-11-20". Bij een meerdaags event ("19-20 november")
 * de eerste dag, net als de vraag naar de eventdatum.
 *
 * Zonder jaartal de eerstvolgende keer dat het die dag is, vanaf `vandaag`. Een datum die al
 * geweest is, of een naam zonder datum, geeft null: dan valt er niets voor te kiezen.
 */
export function datumUitEventNaam(event: string, vandaag: string): string | null {
  const naam = event.toLowerCase()
  const nu = /^(\d{4})-(\d{2})-(\d{2})/.exec(vandaag)
  if (!nu) return null
  const ditJaar = Number(nu[1])

  const kies = (j: number | null, m: number, d: number): string | null => {
    if (j !== null) return geldigeDag(j, m, d) && ISO(j, m, d) >= vandaag ? ISO(j, m, d) : null
    for (const jaar of [ditJaar, ditJaar + 1]) {
      if (geldigeDag(jaar, m, d) && ISO(jaar, m, d) >= vandaag) return ISO(jaar, m, d)
    }
    return null
  }
  const jaarVan = (s: string | undefined) => (!s ? null : s.length === 2 ? 2000 + Number(s) : Number(s))

  // "2026-11-20"
  const iso = /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(naam)
  if (iso) return kies(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  // "20 november", "20 nov. 2026", "19-20 november", "19 t/m 20 november"
  const maanden = MAAND_SCHRIJFWIJZEN.flat().sort((a, b) => b.length - a.length).join('|')
  const woord = new RegExp(
    `(?<!\\d)(\\d{1,2})(?:ste|de|e)?(?:\\s*(?:-|–|/|&|en|t/m|tot)\\s*\\d{1,2}(?:ste|de|e)?)?\\s*[-.]?\\s*(${maanden})\\.?(?![a-z])(?:\\s*[-,]?\\s*(\\d{4})(?!\\d))?`,
  ).exec(naam)
  if (woord) {
    const maand = MAAND_SCHRIJFWIJZEN.findIndex((s) => s.includes(woord[2])) + 1
    return kies(jaarVan(woord[3]), maand, Number(woord[1]))
  }

  // "20-11", "20/11/2026", "20.11.26"
  const cijfers = /(?<!\d)(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{4}|\d{2}))?(?!\d)/.exec(naam)
  if (cijfers) return kies(jaarVan(cijfers[3]), Number(cijfers[2]), Number(cijfers[1]))

  return null
}

/**
 * Het event en de eventdatum als twee stukken voor een titel of onderwerp: ["EY", "11 december"].
 * Zonder jaartal, en zonder datum als die er niet is of al in de eventnaam staat.
 */
export function eventEnDatum(event: string, eventDatum: string | null | undefined): string[] {
  const datum = eventDatum && !eventNaamBevatDatum(event, eventDatum) ? formatDateShortNl(eventDatum, false) : ''
  return [event.trim(), datum].filter(Boolean)
}

type TitleInput = Pick<Aanvraag,
  'aanvraag_types' | 'anders_tekst' | 'deadline' | 'event' | 'event_datum' | 'naam'>
  & Partial<Pick<Aanvraag, 'soort' | 'omschrijving'>>

export const MEERDERE_DESIGNS = 'Meerdere designs'

/** Wat er staat waar anders de deadline staat, bij een interne aanvraag zonder deadline. */
export const GEEN_DEADLINE = 'Geen deadline'

/** Het label van één aanvraagtype; bij "anders" de vrije tekst. */
export function typeLabel(key: Aanvraag['aanvraag_types'][number], andersTekst: string): string {
  return key === 'anders' ? andersTekst.trim() || 'Anders' : requestTypeLabel(key)
}

/** Zoveel tekens van de omschrijving komen in de taaknaam van een interne aanvraag. */
export const INTERN_TITEL_TEKENS = 60

/**
 * Het begin van de omschrijving, als één regel: "Nieuwe visitekaartjes voor het salesteam, met…".
 * Afgebroken op een woordgrens, zodat er geen half woord in de taaknaam staat.
 */
export function kortVan(tekst: string, max = INTERN_TITEL_TEKENS): string {
  const regel = tekst.replace(/\s+/g, ' ').trim()
  if (regel.length <= max) return regel
  const knip = regel.slice(0, max)
  const spatie = knip.lastIndexOf(' ')
  return `${(spatie > max / 2 ? knip.slice(0, spatie) : knip).replace(/[\s,.;:-]+$/, '')}…`
}

/**
 * Taaknaam in Asana: "<event> - <eventdatum> - <aanvrager> - Deadline: <deadline> - <wat>".
 *
 * Het event staat vooraan, want daar zoek je op in de lijst; wat er gevraagd is staat
 * achteraan. Eén type → dat type ("EY - 11 december - Britt - Deadline: 9 december -
 * Torenscherm"); meer types → "Meerdere designs".
 *
 * Zonder jaartal: de titel is al lang en de echte datum staat in het veld Eventdatum.
 * Staat de eventdatum al in de eventnaam ("Zorgcongres 20 november 2026"), dan komt hij er
 * niet nog een keer achter.
 *
 * Een interne aanvraag: "Intern - <aanvrager> - Deadline: <deadline> - <begin van wat er
 * gevraagd wordt>", of "Geen deadline" waar de deadline staat als die er niet is.
 */
export function taskTitle(a: TitleInput): string {
  const datum = (iso: string) => formatDateShortNl(iso, false)
  // Een interne aanvraag heeft geen event en geen soort design; wat er gevraagd wordt staat
  // alleen in de omschrijving. Vooraan "Intern", zodat hij in de lijst meteen opvalt.
  if (a.soort === 'intern') {
    return [
      'Intern',
      a.naam.trim(),
      // Mag ontbreken: "het mag klaar zijn wanneer het past". Dat staat er dan ook zo.
      a.deadline ? `Deadline: ${datum(a.deadline)}` : GEEN_DEADLINE,
      kortVan(a.omschrijving ?? ''),
    ].filter(Boolean).join(' - ').slice(0, 250)
  }
  const wat = a.aanvraag_types.length === 1 ? typeLabel(a.aanvraag_types[0], a.anders_tekst) : MEERDERE_DESIGNS
  return [
    // Staat de datum al in de eventnaam, dan niet nog een keer.
    ...eventEnDatum(a.event, a.event_datum),
    a.naam.trim(),
    a.deadline ? `Deadline: ${datum(a.deadline)}` : GEEN_DEADLINE,
    wat,
  ].filter(Boolean).join(' - ').slice(0, 250)
}

/**
 * Naam van de deadline-mijlpaal: de taaknaam zonder de datums, want de mijlpaal staat zelf al op
 * de deadline. "EY - Britt - Torenscherm", of "Intern - Abel - Nieuwe reserveerborden…".
 */
export function deadlineTitel(a: TitleInput): string {
  if (a.soort === 'intern') {
    return ['Intern', a.naam.trim(), kortVan(a.omschrijving ?? '')].filter(Boolean).join(' - ').slice(0, 250)
  }
  const wat = a.aanvraag_types.length === 1 ? typeLabel(a.aanvraag_types[0], a.anders_tekst) : MEERDERE_DESIGNS
  return [a.event.trim(), a.naam.trim(), wat].filter(Boolean).join(' - ').slice(0, 250)
}

/**
 * De namen waarop de worker de menu-subtaak herkent: "Menu scherm …",
 * "Menukaart print …". Daar hangt Marketing het logo van de opdrachtgever aan, en
 * zonder logo maakt de worker geen scherm — er staat dan een rode plaatshouder waar
 * het logo hoort. Afgeleid van de aanvraagtypes zelf, zodat een hernoemd type niet
 * stilletjes de koppeling breekt.
 */
export const MENU_SUBTAAK_NAMEN: readonly string[] = MENU_TYPES.map((k) => requestTypeLabel(k))

/** Begint deze subtaaknaam met een van de menu-namen? */
export function isMenuSubtaak(naam: string): boolean {
  return MENU_SUBTAAK_NAMEN.some((n) => String(naam ?? '').startsWith(n))
}

/**
 * Bij meer dan één type: een subtaak per type ("Torenscherm Deloitte").
 *
 * Een menukaart of menuscherm krijgt er altijd een, ook als het de enige aanvraag
 * is. Die subtaak is de vaste plek voor het logo van de opdrachtgever; zonder die
 * plek is er niets om het aan te hangen en kan de worker niet beginnen.
 */
export function subtaskTitles(a: TitleInput): string[] {
  if (a.soort === 'intern') return []
  const nodig = a.aanvraag_types.length > 1
    ? a.aanvraag_types
    : a.aanvraag_types.filter((k) => MENU_TYPES.includes(k))
  return nodig.map((k) => `${typeLabel(k, a.anders_tekst)} ${a.event.trim()}`.slice(0, 250))
}
