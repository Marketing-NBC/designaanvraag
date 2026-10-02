import { aantalGerechten, pakketVan, wijzigingen, type MenuKeuze } from './menu'
import { DESIGN_MODES, describeRequestTypes, vraagtOmMenu } from '../../../shared/request-types'
import { formatLong } from './dates'
import type { Draft } from '../state'

export interface ReviewRow {
  /** Id van de stap; het overzicht zoekt daar de plek in de stappenlijst bij op. */
  stepId: string
  label: string
  value: string
  muted?: boolean
}

/** Het menu in het overzicht: het pakket, en hoeveel ervan is afgeweken. */
function menuSamenvatting(menu: MenuKeuze): string {
  const pakket = pakketVan(menu.pakket)
  if (!pakket) return 'Niet ingevuld'
  const n = aantalGerechten(menu)
  const anders = wijzigingen(menu).length
  const staart = anders ? `, ${anders} ${anders === 1 ? 'wijziging' : 'wijzigingen'}` : ' (ongewijzigd)'
  return `${pakket.naam} — ${n} ${n === 1 ? 'gerecht' : 'gerechten'}${staart}`
}

export function reviewRows(d: Draft): ReviewRow[] {
  const modus = DESIGN_MODES.find((m) => m.key === d.design_modus)?.label ?? ''
  const gereed = d.bijlagen.filter((b) => b.status === 'klaar')
  const bijlagenRegel = gereed.length ? gereed.map((b) => b.bestandsnaam).join(', ') : 'Niets meegestuurd'
  const rijen: ReviewRow[] = [
    { stepId: 'naam', label: 'naam', value: d.naam },
    { stepId: 'event', label: 'event', value: d.event },
    { stepId: 'event_datum', label: 'eventdatum', value: d.event_datum ? formatLong(d.event_datum) : '' },
    { stepId: 'deadline', label: 'uiterlijk nodig op', value: d.deadline ? formatLong(d.deadline) : '' },
    { stepId: 'website', label: 'website', value: d.website.trim() || 'niet opgegeven' },
    { stepId: 'schijf_locatie', label: 'locatie op de schijf', value: d.schijf_locatie || 'Niet ingevuld', muted: !d.schijf_locatie },
    { stepId: 'bijlagen', label: 'meegestuurd', value: bijlagenRegel, muted: !gereed.length },
    { stepId: 'aanvraag_types', label: 'aanvraag', value: describeRequestTypes(d.aanvraag_types, d.anders_tekst) },
  ]
  if (vraagtOmMenu(d.aanvraag_types)) {
    rijen.push({ stepId: 'menu', label: 'menu', value: menuSamenvatting(d.menu), muted: !d.menu.pakket })
  }
  rijen.push(
    { stepId: 'design_modus', label: 'design', value: modus },
    { stepId: 'omschrijving', label: 'wensen en bijzonderheden', value: d.omschrijving || 'Niet ingevuld', muted: !d.omschrijving },
  )
  return rijen
}
