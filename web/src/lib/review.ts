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

/** Een menu leest in het overzicht prettiger als een opsomming dan als een blok tekst. */
function menuSamenvatting(tekst: string): string {
  const regels = tekst.split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
  const gerechten = regels.filter((r) => /^[\u2022\u2023\u25E6\u00b7\u25CF*-]/.test(r)).length
  const koppen = regels.length - gerechten
  if (!regels.length) return 'Niet ingevuld'
  return `${koppen} ${koppen === 1 ? 'kopje' : 'kopjes'}, ${gerechten} ${gerechten === 1 ? 'gerecht' : 'gerechten'}`
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
    rijen.push({ stepId: 'menu_tekst', label: 'menu', value: menuSamenvatting(d.menu_tekst), muted: !d.menu_tekst.trim() })
  }
  rijen.push(
    { stepId: 'design_modus', label: 'design', value: modus },
    { stepId: 'omschrijving', label: 'wensen en bijzonderheden', value: d.omschrijving || 'Niet ingevuld', muted: !d.omschrijving },
  )
  return rijen
}
