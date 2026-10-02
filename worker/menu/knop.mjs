/**
 * De knop "Menuscherm" in Asana terugzetten.
 *
 * Marketing zet het veld op "Genereer nu"; de webhook zet het op "Bezig" en start deze
 * worker. Daarna moet iemand hem ook weer op Klaar of Mislukt zetten, anders blijft er
 * "Bezig" staan bij een taak waar het scherm al lang bij hangt. Dat doen we hier, aan
 * het eind van de rit.
 *
 * De gids van het veld en van de opties staan in shared/asana-fields.json, uitgelezen
 * door de workflow "Asana-velden vernieuwen". Staan ze er niet - het veld is nieuw, de
 * workflow is nog niet gedraaid - dan gebeurt er niets. Een menuscherm dat verder klaar
 * is mag nooit stranden op een knop.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { updateCustomFields } from '../lib/asana.mjs'
import { log, REPO_DIR } from '../lib/config.mjs'

const CONFIG = join(REPO_DIR, 'shared', 'asana-fields.json')

/** De veldconfiguratie, of null als die er niet is. */
export function veldconfig(pad = CONFIG) {
  try {
    return JSON.parse(readFileSync(pad, 'utf8'))
  } catch {
    return null
  }
}

/**
 * De waarde voor updateCustomFields, of null met de reden waarom het niet kan.
 *
 * @param {object|null} cfg  de inhoud van shared/asana-fields.json
 * @param {'genereer'|'genereer_kleur'|'bezig'|'klaar_menu'|'mislukt'} optie
 */
export function knopWaarde(cfg, optie) {
  const veld = cfg?.fields?.menuscherm
  if (!veld?.gid) {
    return { reden: 'Het veld "Menuscherm" staat niet in shared/asana-fields.json; '
      + 'draai de workflow "Asana-velden vernieuwen".' }
  }
  const gid = veld.options?.[optie]
  if (!gid) {
    return { reden: `Het veld "Menuscherm" heeft geen optie "${optie}"; `
      + 'draai de workflow "Asana-velden vernieuwen" om de opties aan te vullen.' }
  }
  return { waarde: { [veld.gid]: gid } }
}

/**
 * Zet de knop op een optie. Geeft true terug als dat gelukt is; een mislukking wordt
 * gelogd en niet doorgegeven, want dit is nooit de hoofdzaak.
 */
export async function zetKnop(taskGid, optie, cfg = veldconfig()) {
  if (!taskGid) return false
  const { waarde, reden } = knopWaarde(cfg, optie)
  if (!waarde) {
    log('knop niet gezet', { optie, reden })
    return false
  }
  try {
    await updateCustomFields(taskGid, waarde)
    log('knop gezet', { optie })
    return true
  } catch (e) {
    log('knop zetten mislukt', { optie, error: e.message })
    return false
  }
}
