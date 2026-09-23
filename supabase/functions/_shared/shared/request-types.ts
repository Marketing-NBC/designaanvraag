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

export const DESIGN_MODES = [
  {
    key: 'custom',
    label: 'Volledig custom',
    description: 'Een nieuw ontwerp in de huisstijl van de opdrachtgever of het event.',
  },
  {
    key: 'standaard',
    label: 'Standaard designs',
    description: 'Onze vaste NBC-templates, ingevuld met de gegevens van het event.',
  },
] as const

export type DesignMode = (typeof DESIGN_MODES)[number]['key']
