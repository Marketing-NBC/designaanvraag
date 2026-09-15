import type { AsanaFieldsConfig, AsanaTaskClient } from '../_shared/asana.ts'
import { asanaFields } from '../_shared/asana.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import type { AanvraagDetail, Db } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import { renderAanvullingComment } from '../_shared/notes.ts'
import type { Aanvulling, AanvullingResult } from '../_shared/shared/aanvulling-schema.ts'
import { aanvullingPayloadSchema } from '../_shared/shared/aanvulling-schema.ts'
import type { RequestTypeKey } from '../_shared/shared/request-types.ts'

/**
 * POST → een aanvulling op een aanvraag die al een Asana-taak heeft.
 *
 * Er komt géén tweede taak: de toelichting belandt als reactie onder de bestaande taak, en een paar
 * velden worden bijgewerkt. Regels daarbij, allemaal om te voorkomen dat werk van Marketing zomaar
 * verdwijnt:
 *  - Type aanvraag wordt alleen aangevuld, nooit uitgekleed; wat in Asana staat is daarbij leidend.
 *  - Eventdatum en deadline gaan alleen mee als ze echt anders zijn.
 *  - Schijf wordt alleen gevuld als het veld nog leeg is; anders staat het pad in de reactie.
 *  - Spoed blijft zoals bij de aanvraag: dat cijfer meet het aanvraaggedrag van toen.
 *  - De vervaldatum van de taak blijft onaangeroerd; dat is de planning van Marketing.
 */

export interface Deps {
  env: Env
  db: Db
  asana: AsanaTaskClient | null
  /** Veldmapping; standaard shared/asana-fields.json. Alleen tests geven hier iets anders mee. */
  fields?: AsanaFieldsConfig
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

const MAX_BODY_BYTES = 32 * 1024
/** Sneller dan dit is geen mens. */
const MIN_FILL_MS = 3_000

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  return first || req.headers.get('cf-connecting-ip') || null
}

function veldNaam(cfg: AsanaFieldsConfig, sleutel: string, terugval: string): string {
  return cfg.fields?.[sleutel]?.name ?? terugval
}

export interface Wijziging {
  /** Wat er naar Asana gaat, per veld-gid. */
  velden: Record<string, unknown>
  /** Leesbare namen van de velden die veranderen, voor de reactie en de administratie. */
  bijgewerkt: string[]
  /** Types zoals ze na deze aanvulling in onze eigen administratie horen te staan. */
  nieuweTypes: RequestTypeKey[]
  /** Pad dat niet is overgenomen omdat het veld al gevuld was. */
  schijfNietOvergenomen: string
}

/**
 * Bepaalt wat er daadwerkelijk verandert. Los van de handler zodat de regels op zichzelf te testen
 * zijn — en omdat "wat verandert er" de hele kern van deze function is.
 */
export function bepaalWijziging(
  a: Aanvulling,
  row: AanvraagDetail,
  huidigeVelden: Record<string, { optieGids: string[]; datum: string | null; tekst: string | null }>,
  cfg: AsanaFieldsConfig,
): Wijziging {
  const velden: Record<string, unknown> = {}
  const bijgewerkt: string[] = []
  const f = cfg.fields ?? {}

  // Types: de unie van wat er in Asana staat en wat erbij gevraagd wordt. Asana is hier leidend,
  // niet onze eigen kolom: Marketing kan zelf een type hebben bijgezet, en dat hoort te blijven.
  const bestaandeTypes = new Set<RequestTypeKey>(row.aanvraag_types ?? [])
  for (const t of a.extra_types) bestaandeTypes.add(t)
  const nieuweTypes = [...bestaandeTypes]

  const typeVeld = f['type']
  if (typeVeld?.type === 'multi_enum' && a.extra_types.length) {
    const huidig = huidigeVelden[typeVeld.gid]?.optieGids ?? []
    const extra = a.extra_types.map((k) => typeVeld.options?.[k]).filter((g): g is string => Boolean(g))
    const unie = [...new Set([...huidig, ...extra])]
    if (unie.length > huidig.length) {
      velden[typeVeld.gid] = unie
      bijgewerkt.push(veldNaam(cfg, 'type', 'Type aanvraag'))
    }
  }

  const datumVeld = (sleutel: string, nieuw: string | null, oud: string, terugval: string) => {
    if (!nieuw || nieuw === oud) return
    const fld = f[sleutel]
    if (fld?.type !== 'date') return
    // Staat in Asana al precies deze datum, dan is er niets te melden.
    if (huidigeVelden[fld.gid]?.datum === nieuw) return
    velden[fld.gid] = { date: nieuw }
    bijgewerkt.push(veldNaam(cfg, sleutel, terugval))
  }
  datumVeld('eventdatum', a.nieuwe_event_datum, row.event_datum, 'Eventdatum')
  datumVeld('deadline', a.nieuwe_deadline, row.deadline, 'Deadline')

  // Schijf: alleen invullen als er nog niets staat. Wat Marketing zelf heeft ingevoerd overschrijven
  // we niet; dat pad komt dan in de reactie te staan zodat er niets verloren gaat.
  let schijfNietOvergenomen = ''
  if (a.schijf_locatie) {
    const schijfVeld = f['schijf']
    const staatEr = (huidigeVelden[schijfVeld?.gid ?? '']?.tekst ?? row.schijf_locatie ?? '').trim()
    if (schijfVeld?.type === 'text' && !staatEr) {
      velden[schijfVeld.gid] = a.schijf_locatie
      bijgewerkt.push(veldNaam(cfg, 'schijf', 'Schijf'))
    } else if (staatEr !== a.schijf_locatie) {
      schijfNietOvergenomen = a.schijf_locatie
    }
  }

  return { velden, bijgewerkt, nieuweTypes, schijfNietOvergenomen }
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const { env, db } = deps
  const cfg = deps.fields ?? asanaFields
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))

  return async (req) => {
    const cors = corsHeaders(req, env.allowedOrigins)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405, cors)

    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json({ error: 'Aanvulling te groot' }, 413, cors)
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
      log('warn', 'aanvulling geweigerd: honeypot of te snel', { tooFast })
      return json({ aanvulling_id: String(r.client_request_id ?? crypto.randomUUID()), asana_task_url: null, bijgewerkt: [] } satisfies AanvullingResult, 200, cors)
    }

    const parsed = aanvullingPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return json({ error: first?.message ?? 'Controleer je invoer', field: first?.path?.join('.') ?? null }, 400, cors)
    }
    const { aanvulling, client_request_id } = parsed.data

    // Idempotent: dubbelklik of retry plaatst geen tweede reactie.
    const bestaand = await db.findAanvullingByClientRequestId(client_request_id)
    if (bestaand) {
      const eerder = await db.findById(bestaand.aanvraag_id)
      return json({ aanvulling_id: bestaand.id, asana_task_url: eerder?.asana_task_url ?? null, bijgewerkt: bestaand.bijgewerkt ?? [] } satisfies AanvullingResult, 200, cors)
    }

    const ip = clientIp(req)
    const ipHash = ip ? (await sha256(`${ip}|${env.rateSalt}`)).slice(0, 32) : null
    if (ipHash) {
      const n = await db.bumpRateLimit(`ip:${ipHash}`, '1 hour')
      if (n > env.rateLimitIpPerHour) return json({ error: 'Te veel aanvragen achter elkaar. Probeer het over een uur opnieuw.' }, 429, cors)
    }

    const row = await db.findById(aanvulling.aanvraag_id)
    if (!row) return json({ error: 'We konden die aanvraag niet meer vinden. Zoek hem opnieuw op.' }, 404, cors)
    if (!row.asana_task_gid) {
      return json({ error: 'Bij deze aanvraag hoort geen taak in Asana, dus er valt niets aan te vullen. Bel even met Marketing.' }, 409, cors)
    }

    // De ene datum kan pas tegen de andere aan als we de aanvraag erbij hebben: schuift alleen de
    // deadline, dan is de eventdatum uit de aanvraag de grens.
    const effectiefEvent = aanvulling.nieuwe_event_datum ?? row.event_datum
    const effectieveDeadline = aanvulling.nieuwe_deadline ?? row.deadline
    if (effectieveDeadline > effectiefEvent) {
      return json({ error: 'De deadline kan niet na het event liggen', field: 'aanvulling.nieuwe_deadline' }, 400, cors)
    }

    const aanvullingRij = await db.insertAanvulling({ ...aanvulling, client_request_id, ip_hash: ipHash })
    log('info', 'aanvulling opgeslagen', { id: aanvullingRij.id, aanvraag: row.id, event: row.event })

    if (!deps.asana) {
      await db.updateAanvulling(aanvullingRij.id, { asana_error: 'Asana niet geconfigureerd' })
      return json({ aanvulling_id: aanvullingRij.id, asana_task_url: row.asana_task_url, bijgewerkt: [] } satisfies AanvullingResult, 200, cors)
    }

    const waarschuwingen: string[] = []
    let wijziging: Wijziging = { velden: {}, bijgewerkt: [], nieuweTypes: row.aanvraag_types ?? [], schijfNietOvergenomen: aanvulling.schijf_locatie }
    try {
      const taak = await deps.asana.getTask(row.asana_task_gid)
      wijziging = bepaalWijziging(aanvulling, row, taak.customFields, cfg)
      waarschuwingen.push(...(await deps.asana.updateCustomFields(row.asana_task_gid, wijziging.velden)))
    } catch (e) {
      // De reactie is het belangrijkste: die plaatsen we ook als het bijwerken misging.
      const msg = e instanceof Error ? e.message : String(e)
      waarschuwingen.push(`velden bijwerken mislukt: ${msg}`)
      log('warn', 'velden bijwerken mislukt', { id: aanvullingRij.id, error: msg })
    }

    try {
      await deps.asana.addComment(
        row.asana_task_gid,
        renderAanvullingComment({
          naam: aanvulling.naam,
          toelichting: aanvulling.toelichting,
          bijgewerkt: wijziging.bijgewerkt,
          link: aanvulling.link,
          schijfNietOvergenomen: wijziging.schijfNietOvergenomen,
        }),
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log('error', 'reactie plaatsen mislukt', { id: aanvullingRij.id, error: msg })
      await db.updateAanvulling(aanvullingRij.id, { bijgewerkt: wijziging.bijgewerkt, asana_error: `reactie plaatsen mislukt: ${msg}` })
      return json({ error: 'De aanvulling is bewaard, maar kwam niet in Asana terecht. Laat het even weten aan Marketing.' }, 502, cors)
    }

    await db.updateAanvulling(aanvullingRij.id, {
      bijgewerkt: wijziging.bijgewerkt,
      asana_error: waarschuwingen.length ? waarschuwingen.join('; ') : null,
    })

    // Onze eigen administratie meebewegen, zodat een volgende aanvulling van de juiste stand uitgaat.
    const patch: Record<string, unknown> = {}
    if (wijziging.nieuweTypes.length !== (row.aanvraag_types ?? []).length) patch.aanvraag_types = wijziging.nieuweTypes
    if (aanvulling.nieuwe_event_datum && aanvulling.nieuwe_event_datum !== row.event_datum) patch.event_datum = aanvulling.nieuwe_event_datum
    if (aanvulling.nieuwe_deadline && aanvulling.nieuwe_deadline !== row.deadline) patch.deadline = aanvulling.nieuwe_deadline
    if (aanvulling.schijf_locatie && !row.schijf_locatie) patch.schijf_locatie = aanvulling.schijf_locatie
    if (Object.keys(patch).length) await db.update(row.id, patch)

    log('info', 'aanvulling in asana', { id: aanvullingRij.id, gid: row.asana_task_gid, bijgewerkt: wijziging.bijgewerkt })
    return json(
      { aanvulling_id: aanvullingRij.id, asana_task_url: row.asana_task_url, bijgewerkt: wijziging.bijgewerkt } satisfies AanvullingResult,
      200,
      cors,
    )
  }
}
