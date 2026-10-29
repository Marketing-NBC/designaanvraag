/**
 * Voor welke locatie de aanvraag is. Dit is de eerste vraag van het formulier, want het
 * bepaalt wat er daarna te kiezen valt: Green Village heeft niet dezelfde schermen als NBC.
 */
export const LOCATIES = [
  { key: 'nbc', label: 'NBC' },
  { key: 'green_village', label: 'Green Village' },
] as const

export type Locatie = (typeof LOCATIES)[number]['key']

export const LOCATIE_KEYS = LOCATIES.map((l) => l.key) as [Locatie, ...Locatie[]]

export function locatieLabel(key: Locatie): string {
  return LOCATIES.find((l) => l.key === key)?.label ?? String(key ?? '')
}

/**
 * Is de aanvraag voor een evenement of voor iets intern? Dat bepaalt welke vragen er komen:
 * een interne aanvraag heeft geen event, geen eventdatum en geen huisstijl om op te halen;
 * alleen wat er nodig is en wanneer.
 *
 * Het label is wat er in Asana in het veld Soort staat; `vraag` is hoe het in het formulier staat.
 */
export const SOORTEN = [
  { key: 'evenement', label: 'Evenement', vraag: 'Voor een evenement' },
  { key: 'intern', label: 'Intern', vraag: 'Intern' },
] as const

export type Soort = (typeof SOORTEN)[number]['key']

export const SOORT_KEYS = SOORTEN.map((s) => s.key) as [Soort, ...Soort[]]

export function soortLabel(key: Soort): string {
  return SOORTEN.find((s) => s.key === key)?.label ?? String(key ?? '')
}

/** De keuze zoals hij in het formulier staat, als opties voor een keuzelijst. */
export const SOORT_KEUZES = SOORTEN.map((s) => ({ key: s.key, label: s.vraag }))

/**
 * Aanvraagtypes voor "Wat wil je aanvragen?".
 * Gedeeld door frontend, edge function en worker. Keys zijn stabiel; labels mogen wijzigen.
 * De letter (A–H) is de toetsenbord-sneltoets in het formulier.
 */
export const REQUEST_TYPES = [
  { key: 'led_kolom', label: 'LED-kolom' },
  { key: 'torenscherm', label: 'Torenscherm' },
  { key: 'koffiescherm', label: 'Koffiescherm' },
  { key: 'overige_schermen', label: 'Overige schermen' },
  { key: 'menukaart_print', label: 'Menukaart print' },
  { key: 'menu_scherm', label: 'Menu scherm' },
  { key: 'vlaggen', label: 'Vlaggen' },
  { key: 'anders', label: 'Anders, namelijk…' },
] as const

export type RequestTypeKey = (typeof REQUEST_TYPES)[number]['key']

export type RequestType = (typeof REQUEST_TYPES)[number]

/**
 * Wat er per locatie te kiezen valt, in de volgorde waarin het op het scherm staat.
 *
 * Green Village heeft geen LED-kolom, en de volgorde is daar een andere - allebei zoals
 * Abel het heeft doorgegeven. Dit is de enige plek waar dat verschil staat: het formulier,
 * de lettertoetsen en de controle bij het indienen lezen er alle drie uit.
 */
const TYPES_PER_LOCATIE: Record<Locatie, readonly RequestTypeKey[]> = {
  nbc: [
    'led_kolom', 'torenscherm', 'koffiescherm', 'overige_schermen',
    'menukaart_print', 'menu_scherm', 'vlaggen', 'anders',
  ],
  green_village: [
    'torenscherm', 'overige_schermen', 'menukaart_print',
    'menu_scherm', 'koffiescherm', 'vlaggen', 'anders',
  ],
}

/**
 * Bij standaard designs valt er minder te kiezen: alleen wat we als vaste template hebben. De
 * keuze tussen standaard en custom komt daarom vóór "Wat wil je aanvragen?". Bij custom kan alles
 * wat de locatie heeft. Green Village heeft geen LED-kolom, dus daar blijven er twee over.
 */
const STANDAARD_TYPES: readonly RequestTypeKey[] = ['led_kolom', 'torenscherm', 'menu_scherm']

/** Wat er bij standaard designs onder een keuze staat, zodat duidelijk is wat de template is. */
const STANDAARD_UITLEG: Partial<Record<RequestTypeKey, string>> = {
  led_kolom: 'Standaarden van NBC met logo',
}

/** Een keuze bij "Wat wil je aanvragen?", soms met een regel uitleg eronder. */
export interface RequestTypeOptie {
  key: RequestTypeKey
  label: string
  description?: string
}

/**
 * De aanvraagtypes van een locatie, in schermvolgorde. Zonder locatie die van NBC; bij
 * standaard designs alleen de vaste templates.
 */
export function requestTypesVoor(locatie: Locatie | null, modus: DesignMode | null = null): RequestTypeOptie[] {
  const l = locatie ?? 'nbc'
  return TYPES_PER_LOCATIE[l]
    .filter((k) => typeHoortBij(l, k, modus))
    .map((k) => REQUEST_TYPES.find((t) => t.key === k))
    .filter((t): t is RequestType => Boolean(t))
    .map((t) => {
      const uitleg = modus === 'standaard' ? STANDAARD_UITLEG[t.key] : undefined
      return uitleg ? { key: t.key, label: t.label, description: uitleg } : { key: t.key, label: t.label }
    })
}

/** Kan dit type bij deze locatie (en, als die al gekozen is, deze designkeuze) worden aangevraagd? */
export function typeHoortBij(locatie: Locatie, key: RequestTypeKey, modus: DesignMode | null = null): boolean {
  if (!TYPES_PER_LOCATIE[locatie].includes(key)) return false
  return modus !== 'standaard' || STANDAARD_TYPES.includes(key)
}

export const REQUEST_TYPE_KEYS = REQUEST_TYPES.map((t) => t.key) as [RequestTypeKey, ...RequestTypeKey[]]

export function requestTypeLabel(key: RequestTypeKey): string {
  return REQUEST_TYPES.find((t) => t.key === key)?.label ?? key
}

/** Leesbare opsomming voor de Asana-titel en het overzicht, "Anders" vervangen door de vrije tekst. */
export function describeRequestTypes(keys: readonly RequestTypeKey[], andersTekst = ''): string {
  return keys
    .map((k) => (k === 'anders' ? (andersTekst.trim() || 'Anders') : requestTypeLabel(k)))
    .join(', ')
}

/**
 * Aanvraagtypes waar een menu bij hoort. Kiest iemand een van deze, dan vraagt het
 * formulier daarna om de culinaire invulling, en maakt de worker het menuscherm op.
 */
export const MENU_TYPES: readonly RequestTypeKey[] = ['menukaart_print', 'menu_scherm']

export function vraagtOmMenu(keys: readonly RequestTypeKey[]): boolean {
  return keys.some((k) => MENU_TYPES.includes(k))
}

/** In schermvolgorde: standaard is A, custom is B. */
export const DESIGN_MODES = [
  {
    key: 'standaard',
    label: 'Standaard designs',
    // {locatie} wordt ingevuld met NBC of Green Village, al naar gelang de aanvraag.
    description: 'Onze vaste {locatie}-templates, ingevuld met de gegevens van het event.',
  },
  {
    key: 'custom',
    label: 'Volledig custom',
    description: 'Een nieuw ontwerp in de huisstijl van de opdrachtgever of het event.',
  },
] as const

export type DesignMode = (typeof DESIGN_MODES)[number]['key']

/** De designkeuzes zoals ze op het scherm komen, met de locatie in de omschrijving. */
export function designModesVoor(locatie: Locatie | null) {
  const naam = locatieLabel(locatie ?? 'nbc')
  return DESIGN_MODES.map((m) => ({ ...m, description: m.description.replace('{locatie}', naam) }))
}
