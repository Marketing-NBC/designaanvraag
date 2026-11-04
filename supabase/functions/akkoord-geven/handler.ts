import type { AsanaFieldsConfig, AsanaTaskClient } from '../_shared/asana.ts'
import { asanaFields } from '../_shared/asana.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import type { Db } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import type { AkkoordInfo, AkkoordResultaat } from '../_shared/shared/akkoord.ts'
import { renderAkkoordMelding, verslagAkkoord } from '../_shared/shared/akkoord.ts'
import { MARKETING_MAIL, MELDING_ONTVANGERS } from '../_shared/shared/contact.ts'
import type { MailClient } from '../_shared/shared/mail.ts'
import { vandaagInNl } from '../_shared/shared/spoed.ts'
import { z } from 'zod'

/**
 * Akkoord geven op een oplevering. Twee kanten, allebei vanuit het formulier (`?akkoord=<id>`):
 *
 *  GET  ?id=<aanvraag-id>  → wat er klaarstaat: welke aanvraag, welke versie, en of er al akkoord is.
 *  POST { aanvraag_id, naam } → het akkoord. Gaat over de laatst verstuurde versie.
 *
 * Na een akkoord:
 *  - staat het in de tabel opleveringen (akkoord_op, akkoord_door), en stoppen de herinneringen;
 *  - komt er een reactie bij de taak in Asana en gaat de taak naar de kolom Afgerond (afgevinkt);
 *  - krijgt Marketing een mail.
 *
 * Iedereen die de opleveringsmail kreeg mag akkoord geven, ook wie in "Ook mailen naar" staat; dat
 * zijn altijd collega's, de tool is niet voor klanten. Of dat zo moet blijven, bespreekt Abel nog
 * met Karen (zie README, "Akkoord en herinneringen").
 *
 * Een tweede akkoord op dezelfde versie doet niets en zegt wie het al gaf. Asana mag mislukken:
 * het akkoord staat dan toch, en Marketing krijgt het in de mail te horen.
 */

export interface Deps {
  env: Env
  db: Pick<Db, 'findById' | 'laatsteVerstuurd' | 'zetAkkoord' | 'bumpRateLimit'>
  asana: Pick<AsanaTaskClient, 'addComment' | 'rondAf'> | null
  mail?: MailClient | null
  fields?: AsanaFieldsConfig
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 4 * 1024

const akkoordSchema = z.object({
  aanvraag_id: z.string().regex(UUID_RE, 'Ongeldige aanvraag'),
  naam: z.string().trim().min(2, 'Vul je naam in').max(80, 'Maximaal 80 tekens'),
  /** Honeypot: mensen laten dit leeg. */
  website_confirm: z.string().max(0).optional(),
})

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  return xff?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || null
}

const NIET_OPEN = `Deze aanvraag staat niet meer open bij Marketing. Mail even naar ${MARKETING_MAIL} als je denkt dat dat niet klopt.`

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const { env, db } = deps
  const cfg = deps.fields ?? asanaFields
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))

  /** Wat er klaarstaat; null als de aanvraag niet (meer) openstaat. */
  async function info(id: string): Promise<AkkoordInfo | null> {
    const a = await db.findById(id)
    if (!a || !a.asana_task_gid || a.vervallen_op) return null
    const o = await db.laatsteVerstuurd(a.id)
    const omschrijving = a.soort === 'intern' ? a.omschrijving.replace(/\s+/g, ' ').trim().slice(0, 140) : ''
    return {
      status: !o ? 'geen_oplevering' : o.akkoord_op ? 'akkoord' : 'open',
      soort: a.soort,
      event: a.event,
      event_datum: a.event_datum,
      omschrijving,
      aanvraag_types: a.aanvraag_types ?? [],
      anders_tekst: a.anders_tekst,
      versie: o?.versie ?? null,
      verstuurd_op: o?.verstuurd_op ?? null,
      akkoord_op: o?.akkoord_op ?? null,
      akkoord_door: o?.akkoord_door ?? null,
    }
  }

  return async (req) => {
    const cors = corsHeaders(req, env.allowedOrigins)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })

    if (req.method === 'GET') {
      const id = new URL(req.url).searchParams.get('id') ?? ''
      if (!UUID_RE.test(id)) return json({ error: 'Ongeldige aanvraag' }, 400, cors)
      const uit = await info(id.toLowerCase())
      return uit ? json(uit, 200, cors) : json({ error: NIET_OPEN }, 404, cors)
    }
    if (req.method !== 'POST') return json({ error: 'Alleen GET en POST' }, 405, cors)

    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'Te groot' }, 413, cors)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return json({ error: 'Ongeldige JSON' }, 400, cors)
    }
    const parsed = akkoordSchema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return json({ error: first?.message ?? 'Controleer je invoer', field: first?.path?.join('.') ?? null }, 400, cors)
    }
    const { aanvraag_id, naam } = parsed.data

    const ip = clientIp(req)
    if (ip) {
      const n = await db.bumpRateLimit(`ip:${(await sha256(`${ip}|${env.rateSalt}`)).slice(0, 32)}`, '1 hour')
      if (n > env.rateLimitIpPerHour) return json({ error: 'Te veel verzoeken achter elkaar. Probeer het over een uur opnieuw.' }, 429, cors)
    }

    const a = await db.findById(aanvraag_id.toLowerCase())
    if (!a || !a.asana_task_gid || a.vervallen_op) return json({ error: NIET_OPEN }, 404, cors)
    const o = await db.laatsteVerstuurd(a.id)
    if (!o) return json({ error: 'Er is nog niets opgeleverd bij deze aanvraag, dus er valt nog niets goed te keuren.' }, 409, cors)
    if (o.akkoord_op) {
      return json({ versie: o.versie, door: o.akkoord_door ?? naam, al: true } satisfies AkkoordResultaat, 200, cors)
    }

    const moment = now()
    if (!(await db.zetAkkoord(o.id, naam, moment))) {
      // Iemand anders was net eerder; dat is ook goed.
      const nu = await db.laatsteVerstuurd(a.id)
      return json({ versie: o.versie, door: nu?.akkoord_door ?? naam, al: true } satisfies AkkoordResultaat, 200, cors)
    }
    log('info', 'akkoord gegeven', { aanvraag: a.id, oplevering: o.id, versie: o.versie })

    // Asana: een reactie, en de taak naar Afgerond. Bestaat die kolom (nog) niet, dan naar Klaar.
    let asanaFout: string | null = null
    const afgerondGid = cfg.sections?.afgerond?.gid ?? null
    if (deps.asana) {
      try {
        await deps.asana.addComment(a.asana_task_gid, verslagAkkoord({ door: naam, versie: o.versie, datum: vandaagInNl(moment), afgerond: Boolean(afgerondGid) }))
        await deps.asana.rondAf(a.asana_task_gid, afgerondGid ?? cfg.sections?.klaar?.gid ?? null)
        if (!afgerondGid) asanaFout = 'De kolom Afgerond bestaat nog niet in Asana; de taak staat in Klaar. Draai "Asana-velden vernieuwen".'
      } catch (e) {
        asanaFout = e instanceof Error ? e.message : String(e)
        log('error', 'akkoord in asana mislukt', { aanvraag: a.id, error: asanaFout })
      }
    } else {
      asanaFout = 'De koppeling met Asana is niet ingesteld.'
    }

    if (deps.mail) {
      try {
        await deps.mail.verstuur(renderAkkoordMelding({
          aan: MELDING_ONTVANGERS[a.locatie] ?? MELDING_ONTVANGERS.nbc,
          locatie: a.locatie,
          door: naam,
          versie: o.versie,
          asanaUrl: a.asana_task_url,
          asanaFout,
          soort: a.soort,
          event: a.event,
          eventDatum: a.event_datum,
          omschrijving: a.omschrijving,
          types: a.aanvraag_types ?? [],
          andersTekst: a.anders_tekst,
        }))
      } catch (e) {
        log('error', 'akkoord mailen mislukt', { aanvraag: a.id, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return json({ versie: o.versie, door: naam, al: false } satisfies AkkoordResultaat, 200, cors)
  }
}
