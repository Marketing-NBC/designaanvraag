import { corsHeaders, json } from '../_shared/cors.ts'
import type { Env } from '../_shared/env.ts'
import type { AsanaClient } from '../_shared/asana.ts'
import { asanaFields, buildCustomFields } from '../_shared/asana.ts'
import type { Db } from '../_shared/db.ts'
import { renderNotes } from '../_shared/notes.ts'
import { subtaskTitles, taskTitle } from '../_shared/shared/asana-title.ts'
import type { RoutineClient } from '../_shared/routine.ts'
import { submitPayloadSchema, type SubmitResult } from '../_shared/shared/aanvraag-schema.ts'
import { isSpoed, vandaagInNl, werkdagenTotEvent } from '../_shared/shared/spoed.ts'

export interface Deps {
  env: Env
  db: Db
  asana: AsanaClient | null
  routine: RoutineClient | null
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

const MAX_BODY_BYTES = 64 * 1024
/** Sneller dan dit is geen mens. */
const MIN_FILL_MS = 5_000

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  return first || req.headers.get('cf-connecting-ip') || null
}

function resultOf(row: { id: string; asana_task_url: string | null; brand_status: string; brand_session_url: string | null }): SubmitResult {
  return { aanvraag_id: row.id, asana_task_url: row.asana_task_url, brand_dispatched: row.brand_status === 'running' || row.brand_status === 'done' }
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const { env, db } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))

  return async (req) => {
    const cors = corsHeaders(req, env.allowedOrigins)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405, cors)

    // Body lezen met een harde limiet.
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'Aanvraag te groot' }, 413, cors)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return json({ error: 'Ongeldige JSON' }, 400, cors)
    }

    // Honeypot en tijdcheck: doen alsof het gelukt is, zonder iets op te slaan.
    const r = raw as { website_confirm?: unknown; started_at?: unknown; client_request_id?: unknown }
    const startedAt = typeof r.started_at === 'string' ? Date.parse(r.started_at) : NaN
    const tooFast = Number.isFinite(startedAt) && now().getTime() - startedAt < MIN_FILL_MS
    if ((typeof r.website_confirm === 'string' && r.website_confirm.length > 0) || tooFast) {
      log('warn', 'submit geweigerd: honeypot of te snel', { tooFast })
      return json({ aanvraag_id: String(r.client_request_id ?? crypto.randomUUID()), asana_task_url: null, brand_dispatched: false } satisfies SubmitResult, 200, cors)
    }

    const parsed = submitPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return json({ error: first?.message ?? 'Controleer je invoer', field: first?.path?.join('.') ?? null }, 400, cors)
    }
    const { aanvraag, client_request_id } = parsed.data

    // Idempotent: dubbelklik of retry geeft hetzelfde resultaat terug.
    const existing = await db.findByClientRequestId(client_request_id)
    if (existing) return json(resultOf(existing), 200, cors)

    // Rate limits: per IP per uur, en een globaal dagplafond (beschermt Routine-runs en Asana).
    const ip = clientIp(req)
    const ipHash = ip ? (await sha256(`${ip}|${env.rateSalt}`)).slice(0, 32) : null
    if (ipHash) {
      const n = await db.bumpRateLimit(`ip:${ipHash}`, '1 hour')
      if (n > env.rateLimitIpPerHour) return json({ error: 'Te veel aanvragen achter elkaar. Probeer het over een uur opnieuw.' }, 429, cors)
    }
    const g = await db.bumpRateLimit('global', '1 day')
    if (g > env.rateLimitGlobalPerDay) return json({ error: 'Het dagelijkse maximum aan aanvragen is bereikt. Probeer het morgen opnieuw of bel Marketing.' }, 429, cors)

    // Spoed: minder dan 10 werkdagen tot het event, gemeten op het moment van indienen. Daarna
    // verandert de waarde niet meer, ook niet als de eventdatum later verschuift.
    const vandaag = vandaagInNl(now())
    const werkdagen = werkdagenTotEvent(aanvraag.event_datum, vandaag)
    const spoed = isSpoed(aanvraag.event_datum, vandaag)

    const row = await db.insert({
      ...aanvraag,
      client_request_id,
      ip_hash: ipHash,
      spoed,
      werkdagen_tot_event: Number.isFinite(werkdagen) ? werkdagen : null,
    })
    log('info', 'aanvraag opgeslagen', { id: row.id, event: aanvraag.event, spoed, werkdagen })

    // Asana-taak (fase 3). Zonder configuratie slaan we dit over; de aanvraag blijft bewaard.
    let asanaUrl: string | null = null
    let asanaGid: string | null = null
    const projectGid = env.asanaProjectGid ?? asanaFields.project?.gid ?? null
    if (deps.asana && projectGid) {
      try {
        const notes = renderNotes(aanvraag, { aanvraagId: row.id })
        const task = await deps.asana.createTask({
          name: taskTitle(aanvraag),
          htmlNotes: notes.html,
          plainNotes: notes.plain,
          projectGid,
          sectionGid: asanaFields.sections?.nieuwe_aanvragen?.gid ?? null,
          assigneeGid: env.asanaAssigneeGid ?? asanaFields.assignee?.gid ?? null,
          customFields: buildCustomFields(aanvraag, undefined, { spoed }),
          subtasks: subtaskTitles(aanvraag),
        })
        asanaGid = task.gid
        asanaUrl = task.url
        // Onderdelen die Asana weigerde (een veld, de kolom, de opmaak) blijven zichtbaar in
        // `asana_error`; de taak zelf bestaat, dus de aanvraag slaagt.
        const gedeeltelijk = task.warnings.length ? task.warnings.join('; ') : null
        await db.update(row.id, { asana_task_gid: task.gid, asana_task_url: task.url, asana_error: gedeeltelijk })
        if (gedeeltelijk) log('warn', 'asana-taak onvolledig', { id: row.id, gid: task.gid, warnings: gedeeltelijk })
        else log('info', 'asana-taak aangemaakt', { id: row.id, gid: task.gid, subtasks: task.subtasks })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log('error', 'asana mislukt', { id: row.id, error: msg })
        await db.update(row.id, { asana_error: msg, brand_status: 'failed', brand_error: 'Geen Asana-taak, dus geen huisstijl-extractie.' })
        return json({ aanvraag_id: row.id, asana_task_url: null, brand_dispatched: false } satisfies SubmitResult, 200, cors)
      }
    } else {
      await db.update(row.id, { asana_error: 'Asana niet geconfigureerd', brand_status: 'failed', brand_error: 'Asana niet geconfigureerd' })
      return json({ aanvraag_id: row.id, asana_task_url: null, brand_dispatched: false } satisfies SubmitResult, 200, cors)
    }

    // Huisstijl-extractie via de Routine (fase 4).
    let dispatched = false
    if (deps.routine && asanaGid) {
      try {
        const { sessionUrl } = await deps.routine.fire(`aanvraag_id=${row.id}`)
        await db.update(row.id, { brand_status: 'running', brand_session_url: sessionUrl })
        dispatched = true
        log('info', 'routine gestart', { id: row.id, sessionUrl })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log('error', 'routine mislukt', { id: row.id, error: msg })
        await db.update(row.id, { brand_status: 'failed', brand_error: msg })
      }
    } else {
      await db.update(row.id, { brand_status: 'failed', brand_error: 'Routine niet geconfigureerd' })
    }

    return json({ aanvraag_id: row.id, asana_task_url: asanaUrl, brand_dispatched: dispatched } satisfies SubmitResult, 200, cors)
  }
}
