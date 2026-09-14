import type { Aanvraag } from './aanvraag-schema.ts'
import { requestTypeLabel } from './request-types.ts'

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

/** "2026-10-20" → "20 oktober 2026". Puur op de ISO-string, dus zonder tijdzone-verrassingen. */
export function formatDateShortNl(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

type TitleInput = Pick<Aanvraag, 'aanvraag_types' | 'anders_tekst' | 'event' | 'event_datum' | 'naam'>

export const MEERDERE_DESIGNS = 'Meerdere designs'

/** Het label van één aanvraagtype; bij "anders" de vrije tekst. */
export function typeLabel(key: Aanvraag['aanvraag_types'][number], andersTekst: string): string {
  return key === 'anders' ? andersTekst.trim() || 'Anders' : requestTypeLabel(key)
}

/**
 * Taaknaam in Asana: "<wat> <event> - <eventdatum> - <aanvrager>".
 * Eén type → dat type ("Torenscherm Deloitte - 20 oktober 2026 - Wendy");
 * meer types → altijd "Meerdere designs Deloitte - 20 oktober 2026 - Wendy".
 */
export function taskTitle(a: TitleInput): string {
  const wat = a.aanvraag_types.length === 1 ? typeLabel(a.aanvraag_types[0], a.anders_tekst) : MEERDERE_DESIGNS
  return `${wat} ${a.event.trim()} - ${formatDateShortNl(a.event_datum)} - ${a.naam.trim()}`.slice(0, 250)
}

/** Bij meer dan één type: een subtaak per type ("Torenscherm Deloitte"). Anders geen subtaken. */
export function subtaskTitles(a: TitleInput): string[] {
  if (a.aanvraag_types.length < 2) return []
  return a.aanvraag_types.map((k) => `${typeLabel(k, a.anders_tekst)} ${a.event.trim()}`.slice(0, 250))
}
