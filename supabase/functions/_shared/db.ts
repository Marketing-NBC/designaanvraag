import { createClient } from '@supabase/supabase-js'
import type { Aanvraag } from './shared/aanvraag-schema.ts'

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
}

const ROW_COLUMNS = 'id, client_request_id, asana_task_gid, asana_task_url, asana_error, spoed, werkdagen_tot_event, brand_status, brand_error, brand_session_url'

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
