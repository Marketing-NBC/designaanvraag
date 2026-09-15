import { corsHeaders, json } from '../_shared/cors.ts'
import type { Env } from '../_shared/env.ts'
import type { GevondenAanvraag } from '../_shared/shared/aanvulling-schema.ts'
import { ZOEK_MIN_TEKENS } from '../_shared/shared/aanvulling-schema.ts'

/**
 * GET ?q=<eventnaam> → de recente aanvragen waarvan de eventnaam daarop lijkt.
 *
 * Hiermee vindt een collega zijn eerdere aanvraag terug om er iets aan toe te voegen. De pagina
 * staat op het open internet, dus dit endpoint geeft zo min mogelijk prijs: minimaal drie letters,
 * alleen aanvragen van de afgelopen maanden, hooguit tien treffers, en een eigen uurlimiet per IP.
 */

export interface Deps {
  env: Env
  zoek(q: string, vandaag: Date): Promise<GevondenAanvraag[]>
  bumpRateLimit(key: string, window: '1 hour' | '1 day'): Promise<number>
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

/** Ruimer dan het indienen: zoeken is goedkoop en mensen typen letter voor letter. */
export const ZOEK_LIMIET_PER_UUR = 120

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  return first || req.headers.get('cf-connecting-ip') || null
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))

  return async (req) => {
    const cors = { ...corsHeaders(req, deps.env.allowedOrigins), 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'GET') return json({ error: 'Alleen GET' }, 405, cors)

    const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
    // Te kort is geen fout: het formulier zoekt tijdens het typen, dus geef gewoon niets terug.
    if (q.length < ZOEK_MIN_TEKENS) return json({ resultaten: [] }, 200, cors)

    const ip = clientIp(req)
    if (ip) {
      const sleutel = `zoek:${(await sha256(`${ip}|${deps.env.rateSalt}`)).slice(0, 32)}`
      const n = await deps.bumpRateLimit(sleutel, '1 hour')
      if (n > ZOEK_LIMIET_PER_UUR) {
        log('warn', 'zoeken geweigerd: te veel verzoeken', { n })
        return json({ error: 'Te veel zoekopdrachten achter elkaar. Probeer het over een uur opnieuw.' }, 429, cors)
      }
    }

    const resultaten = await deps.zoek(q, now())
    return json({ resultaten }, 200, cors)
  }
}
