import { corsHeaders, json } from '../_shared/cors.ts'
import type { Env } from '../_shared/env.ts'

export interface StatusRow {
  id: string
  brand_status: 'pending' | 'running' | 'done' | 'failed' | 'overgeslagen'
  asana_task_url: string | null
  /** Reden waarom de huisstijl niet lukte; alleen zichtbaar voor wie het aanvraag-id kent. */
  brand_error: string | null
}

export interface StatusDeps {
  env: Env
  find: (id: string) => Promise<StatusRow | null>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** GET ?id=<uuid> → { brand_status, asana_task_url }. Alleen wie de UUID kent kan de status zien. */
export function createStatusHandler(deps: StatusDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const cors = corsHeaders(req, deps.env.allowedOrigins)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })
    if (req.method !== 'GET') return json({ error: 'Alleen GET' }, 405, cors)
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!UUID_RE.test(id)) return json({ error: 'Ongeldig id' }, 400, cors)
    const row = await deps.find(id)
    if (!row) return json({ error: 'Niet gevonden' }, 404, cors)
    return json(
      { aanvraag_id: row.id, brand_status: row.brand_status, asana_task_url: row.asana_task_url, brand_error: row.brand_error ?? null },
      200,
      cors,
    )
  }
}
