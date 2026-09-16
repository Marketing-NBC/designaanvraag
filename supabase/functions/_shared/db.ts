import { createClient } from '@supabase/supabase-js'
import type { Aanvraag } from './shared/aanvraag-schema.ts'
import type { Aanvulling, GevondenAanvraag } from './shared/aanvulling-schema.ts'
import { ZOEK_DAGEN, ZOEK_MAX_RESULTATEN } from './shared/aanvulling-schema.ts'
import type { RequestTypeKey } from './shared/request-types.ts'

export interface AanvraagRow {
  id: string
  client_request_id: string
  asana_task_gid: string | null
  asana_task_url: string | null
  asana_error: string | null
  /** Minder dan 10 werkdagen tot het event, bepaald bij het indienen. */
  spoed: boolean
  /** Werkdagen tussen de aanvraag en het event; negatief kan niet, het formulier blokkeert dat. */
  werkdagen_tot_event: number | null
  brand_status: 'pending' | 'running' | 'done' | 'failed' | 'overgeslagen'
  brand_error: string | null
  brand_session_url: string | null
}

/**
 * De aanvraag zoals een aanvulling hem nodig heeft: niet alleen de Asana-koppeling maar ook wat er
 * ooit is ingevuld, zodat de function kan zien wat er werkelijk verandert.
 */
export interface AanvraagDetail extends AanvraagRow {
  event: string
  event_datum: string
  deadline: string
  aanvraag_types: RequestTypeKey[]
  anders_tekst: string
  schijf_locatie: string
}

export interface AanvullingRow {
  id: string
  aanvraag_id: string
  client_request_id: string
  bijgewerkt: string[]
  asana_error: string | null
}

export interface NewAanvulling extends Aanvulling {
  client_request_id: string
  ip_hash: string | null
}

export type BijlageStatus = 'verwacht' | 'gekoppeld' | 'mislukt' | 'geweigerd' | 'opgeruimd'

export interface BijlageRow {
  id: string
  groep_id: string
  bestandsnaam: string
  mime: string
  bytes: number
  storage_path: string
  status: BijlageStatus
  asana_gid: string | null
}

export interface NewBijlage {
  /** Zelf gemunt, want het opslagpad bevat hem: `<groep_id>/<id>.<ext>`. */
  id: string
  groep_id: string
  bestandsnaam: string
  mime: string
  bytes: number
  storage_path: string
  ip_hash: string | null
}

/** Bij welke aanvraag of aanvulling een bijlage hoort; precies één van de twee. */
export type BijlageOuder = { aanvraag_id: string } | { aanvulling_id: string }

export interface NewAanvraag extends Aanvraag {
  client_request_id: string
  ip_hash: string | null
  spoed: boolean
  werkdagen_tot_event: number | null
}

export interface Db {
  findByClientRequestId(id: string): Promise<AanvraagRow | null>
  insert(row: NewAanvraag): Promise<AanvraagRow>
  update(id: string, patch: Partial<AanvraagRow>): Promise<void>
  /** Verhoogt de teller voor `key` in het venster en geeft de nieuwe stand terug. */
  bumpRateLimit(key: string, window: '1 hour' | '1 day'): Promise<number>
  /** Staat deze naam in de lijst met collega's? Voorkomt dat willekeurige invoer opties aanmaakt. */
  isCollega(naam: string): Promise<boolean>
  /** De volledige aanvraag, voor het bijwerken vanuit een aanvulling. */
  findById(id: string): Promise<AanvraagDetail | null>
  /** Recente aanvragen waarvan de eventnaam op `q` lijkt, nieuwste eerst. */
  zoekOpEvent(q: string, vandaag: Date): Promise<GevondenAanvraag[]>
  findAanvullingByClientRequestId(id: string): Promise<AanvullingRow | null>
  insertAanvulling(row: NewAanvulling): Promise<AanvullingRow>
  updateAanvulling(id: string, patch: Partial<AanvullingRow>): Promise<void>
  insertBijlagen(rows: NewBijlage[]): Promise<void>
  /**
   * Hangt de bijlagen aan hun aanvraag en geeft terug welke dat gelukt is. Voorwaardelijk: alleen
   * rijen die nog nergens bij horen. Zo kan hetzelfde bestand nooit aan twee aanvragen gekoppeld
   * worden, ook niet als iemand dezelfde ids een tweede keer meestuurt.
   */
  claimBijlagen(ids: string[], ouder: BijlageOuder): Promise<BijlageRow[]>
  /** Bijlagen van deze ouder die nog op doorzetten wachten; voor een herhaalde verzending. */
  openBijlagenVan(ouder: BijlageOuder): Promise<BijlageRow[]>
  markeerBijlage(id: string, patch: Partial<BijlageRow> & { fout?: string | null; asana_url?: string | null }): Promise<void>
}

const ROW_COLUMNS = 'id, client_request_id, asana_task_gid, asana_task_url, asana_error, spoed, werkdagen_tot_event, brand_status, brand_error, brand_session_url'
const DETAIL_COLUMNS = `${ROW_COLUMNS}, event, event_datum, deadline, aanvraag_types, anders_tekst, schijf_locatie`
const ZOEK_COLUMNS = 'id, event, event_datum, deadline, naam, aanvraag_types, anders_tekst, schijf_locatie'
const AANVULLING_COLUMNS = 'id, aanvraag_id, client_request_id, bijgewerkt, asana_error'
const BIJLAGE_COLUMNS = 'id, groep_id, bestandsnaam, mime, bytes, storage_path, status, asana_gid'

/** Tekens waarmee je in een PostgREST-filter uit de waarde zou kunnen breken. */
function veiligeZoekterm(q: string): string {
  return q.replace(/[%_,()\\*]/g, ' ').trim()
}

export function createDb(url: string, secretKey: string): Db {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async findByClientRequestId(id) {
      const { data, error } = await sb.from('aanvragen').select(ROW_COLUMNS).eq('client_request_id', id).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as AanvraagRow | null) ?? null
    },
    async insert(row) {
      const { data, error } = await sb.from('aanvragen').insert(row).select(ROW_COLUMNS).single()
      if (error) throw new Error(`db insert: ${error.message}`)
      return data as AanvraagRow
    },
    async update(id, patch) {
      const { error } = await sb.from('aanvragen').update(patch).eq('id', id)
      if (error) throw new Error(`db update: ${error.message}`)
    },
    async bumpRateLimit(key, window) {
      const { data, error } = await sb.rpc('bump_rate_limit', { p_key: key, p_window: window })
      if (error) throw new Error(`db rate limit: ${error.message}`)
      return Number(data)
    },
    async isCollega(naam) {
      const { data, error } = await sb.from('collegas').select('naam').ilike('naam', naam.trim()).eq('actief', true).limit(1)
      if (error) throw new Error(`db collegas: ${error.message}`)
      return ((data as unknown[] | null) ?? []).length > 0
    },
    async findById(id) {
      const { data, error } = await sb.from('aanvragen').select(DETAIL_COLUMNS).eq('id', id).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as AanvraagDetail | null) ?? null
    },
    async zoekOpEvent(q, vandaag) {
      const term = veiligeZoekterm(q)
      if (!term) return []
      const grens = new Date(vandaag.getTime() - ZOEK_DAGEN * 86_400_000).toISOString()
      const { data, error } = await sb
        .from('aanvragen')
        .select(ZOEK_COLUMNS)
        .ilike('event', `%${term}%`)
        .gte('created_at', grens)
        // Zonder taak valt er niets aan te vullen; die aanvraag hoort niet in de lijst.
        .not('asana_task_gid', 'is', null)
        .order('created_at', { ascending: false })
        .limit(ZOEK_MAX_RESULTATEN)
      if (error) throw new Error(`db zoeken: ${error.message}`)
      return ((data as GevondenAanvraag[] | null) ?? []).map((r) => ({ ...r, aanvraag_types: r.aanvraag_types ?? [] }))
    },
    async findAanvullingByClientRequestId(id) {
      const { data, error } = await sb.from('aanvullingen').select(AANVULLING_COLUMNS).eq('client_request_id', id).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as AanvullingRow | null) ?? null
    },
    async insertAanvulling(row) {
      const { data, error } = await sb.from('aanvullingen').insert(row).select(AANVULLING_COLUMNS).single()
      if (error) throw new Error(`db insert: ${error.message}`)
      return data as AanvullingRow
    },
    async updateAanvulling(id, patch) {
      const { error } = await sb.from('aanvullingen').update(patch).eq('id', id)
      if (error) throw new Error(`db update: ${error.message}`)
    },
    async insertBijlagen(rows) {
      if (!rows.length) return
      const { error } = await sb.from('bijlagen').insert(rows)
      if (error) throw new Error(`db insert bijlagen: ${error.message}`)
    },
    async claimBijlagen(ids, ouder) {
      if (!ids.length) return []
      const { data, error } = await sb
        .from('bijlagen')
        .update(ouder)
        .in('id', ids)
        .eq('status', 'verwacht')
        .is('aanvraag_id', null)
        .is('aanvulling_id', null)
        .select(BIJLAGE_COLUMNS)
      if (error) throw new Error(`db claim bijlagen: ${error.message}`)
      return (data as BijlageRow[] | null) ?? []
    },
    async openBijlagenVan(ouder) {
      const kolom = 'aanvraag_id' in ouder ? 'aanvraag_id' : 'aanvulling_id'
      const waarde = 'aanvraag_id' in ouder ? ouder.aanvraag_id : ouder.aanvulling_id
      const { data, error } = await sb.from('bijlagen').select(BIJLAGE_COLUMNS).eq(kolom, waarde).eq('status', 'verwacht')
      if (error) throw new Error(`db select bijlagen: ${error.message}`)
      return (data as BijlageRow[] | null) ?? []
    },
    async markeerBijlage(id, patch) {
      const { error } = await sb.from('bijlagen').update(patch).eq('id', id)
      if (error) throw new Error(`db update bijlage: ${error.message}`)
    },
  }
}

export interface WebhookStore {
  getSecrets(resource: string): Promise<string[]>
  saveSecret(resource: string, secret: string): Promise<void>
}

/** Secrets van Asana-webhooks (tabel asana_webhooks). */
export function createWebhookStore(url: string, secretKey: string): WebhookStore {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async getSecrets(resource) {
      const { data, error } = await sb.from('asana_webhooks').select('secret').eq('resource_gid', resource).order('created_at', { ascending: false }).limit(5)
      if (error) throw new Error(`db webhooks: ${error.message}`)
      return ((data as { secret: string }[] | null) ?? []).map((r) => r.secret)
    },
    async saveSecret(resource, secret) {
      const { error } = await sb.from('asana_webhooks').upsert({ resource_gid: resource, secret }, { onConflict: 'resource_gid,secret' })
      if (error) throw new Error(`db webhooks: ${error.message}`)
    },
  }
}
