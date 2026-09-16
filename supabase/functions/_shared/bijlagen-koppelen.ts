import type { BijlageRow } from './db.ts'
import type { Storage } from './storage.ts'
import { MAX_BIJLAGEN_BYTES_TOTAAL, MAX_BIJLAGE_BYTES, formatBytes, magischeBytesKloppen } from './shared/bijlagen.ts'

/**
 * Zet geüploade bestanden als bijlage bij een Asana-taak.
 *
 * Eén voor één, nooit parallel: parallel vermenigvuldigt het geheugengebruik en levert tegen één
 * ontvanger niets op. Binnen het totaalplafond loopt dit ruim binnen de tijd die een edge function
 * krijgt.
 *
 * Mislukken is hier nooit fataal. De aanvraag is het belangrijkste en die is al opgeslagen; wat
 * misging komt als waarschuwing in `asana_error` en de bestandsnamen staan sowieso in de
 * taakbeschrijving, zodat Marketing kan bellen in plaats van gissen.
 */

export interface KoppelDeps {
  storage: Storage
  asana: { uploadAttachment(taskGid: string, naam: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<{ gid: string; url: string | null }> }
  markeer(id: string, patch: { status: BijlageRow['status']; asana_gid?: string | null; asana_url?: string | null; fout?: string | null; gekoppeld_op?: string }): Promise<void>
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

export interface KoppelResultaat {
  /** Namen van de bestanden die daadwerkelijk bij de taak staan. */
  gekoppeld: string[]
  waarschuwingen: string[]
}

export async function koppelBijlagen(taskGid: string, rijen: BijlageRow[], deps: KoppelDeps): Promise<KoppelResultaat> {
  const gekoppeld: string[] = []
  const waarschuwingen: string[] = []
  if (!rijen.length) return { gekoppeld, waarschuwingen }

  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})
  let totaal = 0

  for (const rij of rijen) {
    try {
      const bestand = await deps.storage.download(rij.storage_path)
      if (!bestand) {
        await deps.markeer(rij.id, { status: 'mislukt', fout: 'bestand niet gevonden in de opslag' })
        waarschuwingen.push(`bijlage "${rij.bestandsnaam}" stond niet meer in de opslag`)
        continue
      }

      // De bucket bewaakt de grens per bestand, maar niet het totaal over een hele aanvraag.
      if (bestand.bytes.length > MAX_BIJLAGE_BYTES || totaal + bestand.bytes.length > MAX_BIJLAGEN_BYTES_TOTAAL) {
        await deps.markeer(rij.id, { status: 'geweigerd', fout: `te groot (${formatBytes(bestand.bytes.length)})` })
        waarschuwingen.push(`bijlage "${rij.bestandsnaam}" overschrijdt de maximale omvang en is overgeslagen`)
        continue
      }

      // De bucket gelooft het type dat de uploader opgaf. Dit is de enige echte controle.
      if (!magischeBytesKloppen(rij.mime, bestand.bytes.subarray(0, 512))) {
        await deps.markeer(rij.id, { status: 'geweigerd', fout: `inhoud past niet bij het opgegeven type ${rij.mime}` })
        waarschuwingen.push(`bijlage "${rij.bestandsnaam}" is geen ${rij.mime} en is overgeslagen`)
        continue
      }

      const bijlage = await deps.asana.uploadAttachment(taskGid, rij.bestandsnaam, bestand.bytes, rij.mime)
      totaal += bestand.bytes.length
      await deps.markeer(rij.id, {
        status: 'gekoppeld',
        asana_gid: bijlage.gid,
        asana_url: bijlage.url,
        fout: null,
        gekoppeld_op: now().toISOString(),
      })
      gekoppeld.push(rij.bestandsnaam)
      log('info', 'bijlage geplaatst', { id: rij.id, naam: rij.bestandsnaam, gid: bijlage.gid })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Niet laten struikelen over de rest: één weerbarstig bestand mag de andere niet meenemen.
      await deps.markeer(rij.id, { status: 'mislukt', fout: msg }).catch(() => {})
      waarschuwingen.push(`bijlage "${rij.bestandsnaam}" mislukt: ${msg}`)
      log('warn', 'bijlage mislukt', { id: rij.id, naam: rij.bestandsnaam, error: msg })
    }
  }

  return { gekoppeld, waarschuwingen }
}
