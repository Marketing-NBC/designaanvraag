import type { DesignMode, RequestTypeKey } from '../../shared/request-types'

/** Het concept in de browser: alle velden optioneel/leeg tot de gebruiker ze invult. */
export interface Draft {
  naam: string
  event: string
  event_datum: string | null
  deadline: string | null
  website: string
  schijf_locatie: string
  aanvraag_types: RequestTypeKey[]
  anders_tekst: string
  design_modus: DesignMode | null
  omschrijving: string
}

export const emptyDraft = (): Draft => ({
  naam: '',
  event: '',
  event_datum: null,
  deadline: null,
  website: '',
  schijf_locatie: '',
  aanvraag_types: [],
  anders_tekst: '',
  design_modus: null,
  omschrijving: '',
})
