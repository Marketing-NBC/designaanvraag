import { typeHoortBij, type DesignMode, type Locatie, type RequestTypeKey, type Soort } from '../../shared/request-types'
import type { Bijlage } from './lib/uploads'
import { leegMenu, type MenuKeuze } from './lib/menu'

/** Het concept in de browser: alle velden optioneel/leeg tot de gebruiker ze invult. */
export interface Draft {
  /** Voor welke locatie: bepaalt wat er bij "Wat wil je aanvragen?" te kiezen valt. */
  locatie: Locatie | null
  naam: string
  /** Evenement of intern: bepaalt welke vragen er na de naam komen. */
  soort: Soort | null
  event: string
  event_datum: string | null
  deadline: string | null
  /** Alleen bij een interne aanvraag: "het mag klaar zijn wanneer het past", dus geen deadline. */
  geen_deadline: boolean
  website: string
  schijf_locatie: string
  /** Alleen de gegevens over de bestanden; de bestanden zelf staan nooit in het concept. */
  bijlagen: Bijlage[]
  aanvraag_types: RequestTypeKey[]
  anders_tekst: string
  design_modus: DesignMode | null
  /** De culinaire invulling; alleen gevraagd bij een menukaart of menuscherm. */
  menu: MenuKeuze
  /** Bij een evenement de wensen en bijzonderheden; bij een interne aanvraag de hele vraag. */
  omschrijving: string
}

export const emptyDraft = (): Draft => ({
  locatie: null,
  naam: '',
  soort: null,
  event: '',
  event_datum: null,
  deadline: null,
  geen_deadline: false,
  website: '',
  schijf_locatie: '',
  bijlagen: [],
  aanvraag_types: [],
  anders_tekst: '',
  design_modus: null,
  menu: leegMenu(),
  omschrijving: '',
})

/**
 * Gooit de aanvraagtypes weg die bij de locatie of de designkeuze niet (meer) te kiezen zijn.
 * Had iemand LED-kolom aangevinkt en zet hij de aanvraag daarna op Green Village, of vinkte hij
 * vlaggen aan en kiest hij toch standaard designs, dan staat die keuze er anders nog in terwijl
 * hij niet meer op het scherm te zien is.
 */
export function alleenTeKiezenTypes(d: Draft): Draft {
  const types = d.aanvraag_types.filter((k) => typeHoortBij(d.locatie ?? 'nbc', k, d.design_modus))
  if (types.length === d.aanvraag_types.length) return d
  return { ...d, aanvraag_types: types, anders_tekst: types.includes('anders') ? d.anders_tekst : '' }
}
