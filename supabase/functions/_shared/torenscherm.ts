import { createClient } from '@supabase/supabase-js'
import { TORENSCHERM_BUCKET, metaPad, ontwerpPad } from './shared/torenscherm-preview.ts'
import type { TorenschermMeta } from './shared/torenscherm-preview.ts'

/**
 * Waar de torenscherm-previews staan: een rij in torenscherm_previews per bijlage uit Asana, en het
 * bestand met een meta.json ernaast in de openbare bucket. Zie shared/torenscherm-preview.ts.
 */

export interface TorenschermPreviewRow {
  id: string
  aanvraag_id: string
  bestand_gid: string
  bestandsnaam: string
  naam: string
  sleutel: string
  bytes: number
}

export interface NieuweTorenschermPreview {
  aanvraagId: string
  bestandGid: string
  bestandsnaam: string
  naam: string
  sleutel: string
  bytes: Uint8Array
  meta: TorenschermMeta
}

export interface TorenschermOpslag {
  /** De preview die al van deze bijlage gemaakt is (bij de proef bijvoorbeeld), of null. */
  bestaand(bestandGid: string): Promise<TorenschermPreviewRow | null>
  /** Zet het design en meta.json in de bucket, en daarna de rij. */
  bewaar(p: NieuweTorenschermPreview): Promise<TorenschermPreviewRow>
}

const COLUMNS = 'id, aanvraag_id, bestand_gid, bestandsnaam, naam, sleutel, bytes'

export function createTorenschermOpslag(url: string, secretKey: string): TorenschermOpslag {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const bak = () => sb.storage.from(TORENSCHERM_BUCKET)

  async function bestaand(bestandGid: string): Promise<TorenschermPreviewRow | null> {
    const { data, error } = await sb.from('torenscherm_previews').select(COLUMNS).eq('bestand_gid', bestandGid).maybeSingle()
    if (error) throw new Error(`db select torenscherm_previews: ${error.message}`)
    return (data as TorenschermPreviewRow | null) ?? null
  }

  return {
    bestaand,
    async bewaar(p) {
      const ontwerp = await bak().upload(ontwerpPad(p.sleutel, p.bestandsnaam), p.bytes, {
        contentType: p.meta.mime, upsert: true, cacheControl: '31536000',
      })
      if (ontwerp.error) throw new Error(`opslaan in de bucket mislukt: ${ontwerp.error.message}`)
      const meta = await bak().upload(metaPad(p.sleutel), new TextEncoder().encode(JSON.stringify(p.meta)), {
        contentType: 'application/json', upsert: true, cacheControl: '300',
      })
      if (meta.error) throw new Error(`meta.json opslaan mislukt: ${meta.error.message}`)

      const rij = {
        aanvraag_id: p.aanvraagId, bestand_gid: p.bestandGid, bestandsnaam: p.bestandsnaam, naam: p.naam, sleutel: p.sleutel, bytes: p.bytes.length,
      }
      const { data, error } = await sb.from('torenscherm_previews').insert(rij).select(COLUMNS).single()
      if (!error) return data as TorenschermPreviewRow
      // Twee pogingen tegelijk met dezelfde bijlage: die van de ander staat er al, en werkt net zo goed.
      if (error.code === '23505') {
        const ander = await bestaand(p.bestandGid)
        if (ander) return ander
      }
      throw new Error(`db insert torenscherm_previews: ${error.message}`)
    },
  }
}
