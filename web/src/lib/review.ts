import { DESIGN_MODES, describeRequestTypes } from '../../../shared/request-types'
import { formatLong } from './dates'
import type { Draft } from '../state'

export interface ReviewRow {
  step: number
  label: string
  value: string
  muted?: boolean
}

export function reviewRows(d: Draft): ReviewRow[] {
  const modus = DESIGN_MODES.find((m) => m.key === d.design_modus)?.label ?? ''
  return [
    { step: 0, label: 'naam', value: d.naam },
    { step: 1, label: 'event', value: d.event },
    { step: 2, label: 'eventdatum', value: d.event_datum ? formatLong(d.event_datum) : '' },
    { step: 3, label: 'uiterlijk nodig op', value: d.deadline ? formatLong(d.deadline) : '' },
    { step: 4, label: 'website', value: d.website },
    { step: 5, label: 'locatie op de schijf', value: d.schijf_locatie || 'Niet ingevuld', muted: !d.schijf_locatie },
    { step: 6, label: 'aanvraag', value: describeRequestTypes(d.aanvraag_types, d.anders_tekst) },
    { step: 7, label: 'design', value: modus },
    { step: 8, label: 'wensen en bijzonderheden', value: d.omschrijving || 'Niet ingevuld', muted: !d.omschrijving },
  ]
}
