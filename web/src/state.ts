import { datumUitEventNaam } from '../../shared/asana-title'
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

/**
 * Een nieuwe eventnaam, en de eventdatum die daarbij hoort. Staat er een datum in de naam
 * ("Zorgcongres 20 november 2026"), dan staat die op het volgende scherm al aangeklikt.
 *
 * Alleen zolang de eventdatum nog leeg is of uit de naam kwam: wie zelf een andere dag
 * koos, houdt die. Haalt iemand de datum uit de naam weg, dan gaat de aangeklikte dag mee.
 * Een deadline na de nieuwe eventdatum vervalt, net als bij zelf een dag kiezen.
 */
export function metEventNaam(d: Draft, event: string, vandaag: string): Partial<Draft> {
  const uitOudeNaam = datumUitEventNaam(d.event, vandaag)
  const uitNieuweNaam = datumUitEventNaam(event, vandaag)
  const volgtNaam = !d.event_datum || d.event_datum === uitOudeNaam
  if (!volgtNaam || uitNieuweNaam === d.event_datum) return { event }
  return {
    event,
    event_datum: uitNieuweNaam,
    deadline: uitNieuweNaam && d.deadline && d.deadline > uitNieuweNaam ? null : d.deadline,
  }
}

/** Staat de gekozen eventdatum er omdat hij in de eventnaam stond? */
export function eventDatumUitNaam(d: Draft, vandaag: string): boolean {
  return Boolean(d.event_datum) && d.event_datum === datumUitEventNaam(d.event, vandaag)
}
