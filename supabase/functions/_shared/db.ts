import { createClient } from '@supabase/supabase-js'
import type { Aanvraag } from './shared/aanvraag-schema.ts'

export interface AanvraagRow {
  id: string
  client_request_id: string
  asana_task_gid: string | null
  asana_task_url: string | null
  asana_error: string | null
  brand_status: 'pending' | 'running' | 'done' | 'failed'
  brand_error: string | null
  brand_session_url: string | null
}

export interface NewAanvraag extends Aanvraag {
  client_request_id: string
  ip_hash: string | null
}

export interface Db {
  findByClientRequestId(id: string): Promise<AanvraagRow | null>
  insert(row: NewAanvraag): Promise<AanvraagRow>
  update(id: string, patch: Partial<AanvraagRow>): Promise<void>
  /** Verhoogt de teller voor `key` in het venster en geeft de nieuwe stand terug. */
  bumpRateLimit(key: string, window: '1 hour' | '1 day'): Promise<number>
}

const ROW_COLUMNS = 'id, client_request_id, asana_task_gid, asana_task_url, asana_error, brand_status, brand_error, brand_session_url'

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
  }
}
