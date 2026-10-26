import type { DesignMode, Locatie, RequestTypeKey, Soort } from '../../shared/request-types'
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
  website: '',
  schijf_locatie: '',
  bijlagen: [],
  aanvraag_types: [],
  anders_tekst: '',
  design_modus: null,
  menu: leegMenu(),
  omschrijving: '',
})
