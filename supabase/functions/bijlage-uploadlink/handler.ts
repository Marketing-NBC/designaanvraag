import { corsHeaders, json } from '../_shared/cors.ts'
import type { NewBijlage } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import type { Storage } from '../_shared/storage.ts'
import type { UploadLink, UploadlinkResult } from '../_shared/shared/bijlagen.ts'
import { bestandsnaamOpschonen, extensieVan, uploadlinkPayloadSchema } from '../_shared/shared/bijlagen.ts'
import { MARKETING_MAIL } from '../_shared/shared/contact.ts'

/**
 * POST → tijdelijke uploadlinks, één per bestand.
 *
 * De browser uploadt daarna rechtstreeks naar Storage; de bytes komen dus nooit door een function
 * heen. Dat is de hele reden dat bijlagen betaalbaar zijn qua tijd en geheugen — maar het betekent
 * ook dat dít het enige moment is waarop wij nee kunnen zeggen. Vandaar dat hier alles langskomt:
 * type, extensie, grootte, aantal, totaal, en een eigen uurlimiet.
 *
 * Wat hierna alsnog fout kan gaan (iemand uploadt andere bytes dan hij opgaf) vangt de bucket op met
 * zijn eigen grens, en anders de controle op de eerste bytes bij het doorzetten naar Asana.
 */

export interface Deps {
  env: Env
  storage: Storage
  insertBijlagen(rows: NewBijlage[]): Promise<void>
  bumpRateLimit(key: string, window: '1 hour' | '1 day'): Promise<number>
  /** Alleen tests geven dit mee; standaard crypto.randomUUID. */
  nieuwId?: () => string
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

const MAX_BODY_BYTES = 8 * 1024
/** Ruimer dan het indienen zelf: uploaden gebeurt per bestand en mensen proberen wel eens opnieuw. */
export const UPLOAD_LIMIET_PER_UUR = 40
export const UPLOAD_LIMIET_PER_DAG = 300

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
  const { env } = deps
  const nieuwId = deps.nieuwId ?? (() => crypto.randomUUID())
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))

  return async (req) => {
    const cors = corsHeaders(req, env.allowedOrigins)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405, cors)

    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'Te veel bestanden in één keer' }, 413, cors)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return json({ error: 'Ongeldige JSON' }, 400, cors)
    }

    const parsed = uploadlinkPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      // Het pad wijst het bestand aan dat niet deugt, zodat het formulier de juiste regel kan kleuren.
      const index = typeof first?.path?.[1] === 'number' ? (first.path[1] as number) : null
      return json({ error: first?.message ?? 'Dit bestand kan niet', bestand: index }, 400, cors)
    }
    const { groep_id, bestanden } = parsed.data

    const ip = clientIp(req)
    const ipHash = ip ? (await sha256(`${ip}|${env.rateSalt}`)).slice(0, 32) : null
    if (ipHash) {
      const n = await deps.bumpRateLimit(`upload:${ipHash}`, '1 hour')
      if (n > UPLOAD_LIMIET_PER_UUR) {
        log('warn', 'uploadlink geweigerd: te veel verzoeken', { n })
        return json({ error: 'Te veel bestanden achter elkaar. Probeer het over een uur opnieuw.' }, 429, cors)
      }
    }
    const globaal = await deps.bumpRateLimit('upload-global', '1 day')
    if (globaal > UPLOAD_LIMIET_PER_DAG) {
      return json({ error: `Het dagelijkse maximum aan bestanden is bereikt. Probeer het morgen opnieuw of mail naar ${MARKETING_MAIL}.` }, 429, cors)
    }

    // Het pad krijgt een eigen uuid en de extensie; de bestandsnaam van de collega komt er bewust
    // niet in voor. Die reist mee in de database en wordt de naam van de bijlage in Asana.
    const rijen: NewBijlage[] = bestanden.map((b) => {
      const id = nieuwId()
      const naam = bestandsnaamOpschonen(b.naam)
      return {
        id,
        groep_id,
        bestandsnaam: naam,
        mime: b.type.trim().toLowerCase(),
        bytes: b.grootte,
        storage_path: `${groep_id}/${id}${extensieVan(naam)}`,
        ip_hash: ipHash,
      }
    })

    const links: UploadLink[] = []
    for (const rij of rijen) {
      links.push({ bijlage_id: rij.id, bestandsnaam: rij.bestandsnaam, signed_url: await deps.storage.uploadlink(rij.storage_path) })
    }

    // Pas opslaan als alle links er zijn: een halve batch levert rijen op waar nooit bytes bij komen.
    await deps.insertBijlagen(rijen)
    log('info', 'uploadlinks uitgegeven', { groep: groep_id, aantal: rijen.length })

    return json({ links } satisfies UploadlinkResult, 200, cors)
  }
}
