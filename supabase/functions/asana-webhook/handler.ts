import { json } from '../_shared/cors.ts'
import type { AsanaFieldsConfig, AsanaTaskClient } from '../_shared/asana.ts'
import { formatDateShortNl } from '../_shared/shared/asana-title.ts'

/**
 * Ontvangt Asana-webhooks van het project "Designaanvragen" en regelt de planning-flow:
 *  - taak naar "In planning" gesleept zonder vervaldatum → één comment met mention: kies een datum;
 *  - vervaldatum gezet terwijl de taak in "In planning" of "Mee bezig" staat → taak ook in het
 *    planningsproject ("4. Werkplanning") zetten. De vervaldatum is een eigenschap van de taak,
 *    dus die is in beide projecten gelijk;
 *  - taak weggegooid of uit het project gehaald → de aanvraag vervalt, zodat hij uit het zoekscherm
 *    verdwijnt en er geen aanvulling meer op kan.
 */

export interface WebhookStore {
  /** Bekende secrets voor deze resource, nieuwste eerst. */
  getSecrets(resource: string): Promise<string[]>
  saveSecret(resource: string, secret: string): Promise<void>
}

export interface Deps {
  /** Vaste token in de webhook-URL; weert vreemde handshakes. */
  token: string
  store: WebhookStore
  asana: AsanaTaskClient
  /**
   * Markeert de aanvraag bij een verwijderde taak als vervallen. Zonder dit blijft een weggegooide
   * aanvraag in het zoekscherm staan en loopt een collega vast op een taak die niet meer bestaat.
   */
  markeerVervallen(asanaTaskGid: string, moment: Date): Promise<boolean>
  now?: () => Date
  cfg: AsanaFieldsConfig
  /** Overschrijft cfg.planning_project (env ASANA_PLANNING_PROJECT_GID). */
  planningProjectGid?: string | null
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

interface AsanaEvent {
  action?: string
  resource?: { gid?: string; resource_type?: string }
  parent?: { gid?: string; resource_type?: string } | null
  change?: { field?: string; action?: string } | null
}

/** Herkenbare zin; hieraan zien we of de vraag al gesteld is. */
export const ASK_DATE_MARKER = 'kies een vervaldatum voor deze taak'
const MAX_BODY_BYTES = 512 * 1024

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function askDateHtml(assigneeGid: string | null, planningName: string): string {
  const mention = assigneeGid ? `<a data-asana-gid="${assigneeGid}"/> ` : ''
  return `<body>${mention}${ASK_DATE_MARKER}. Zodra die staat, komt hij automatisch ook in ${escape(planningName)}.</body>`
}

export function plannedHtml(dueOn: string, planningName: string): string {
  return `<body>Ingepland: staat nu ook in ${escape(planningName)} met vervaldatum ${formatDateShortNl(dueOn)}.</body>`
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const { store, asana, cfg } = deps
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))
  const now = deps.now ?? (() => new Date())
  const projectGid = cfg.project?.gid ?? null
  const sections = cfg.sections ?? {}
  const inPlanning = sections.in_planning?.gid ?? null
  const qualifying = [sections.in_planning?.gid, sections.mee_bezig?.gid].filter((g): g is string => Boolean(g))
  const planningGid = deps.planningProjectGid ?? cfg.planning_project?.gid ?? null
  const planningName = cfg.planning_project?.name ?? 'de werkplanning'

  async function handleTask(gid: string): Promise<string> {
    const t = await asana.getTask(gid)
    const ours = t.memberships.find((m) => m.project === projectGid)
    if (!ours) return 'niet in ons project'
    if (t.completed) return 'afgerond'
    const section = ours.section

    if (!t.dueOn) {
      if (section !== inPlanning) return 'geen datum, niet in planning'
      const comments = await asana.listComments(gid)
      if (comments.some((c) => c.includes(ASK_DATE_MARKER))) return 'datum al gevraagd'
      await asana.addComment(gid, askDateHtml(t.assignee, planningName))
      return 'datum gevraagd'
    }

    if (!section || !qualifying.includes(section)) return 'datum, maar niet in planning of mee bezig'
    if (!planningGid) return 'geen planningsproject geconfigureerd'
    if (t.projects.includes(planningGid)) return 'al ingepland'
    await asana.addToProject(gid, planningGid)
    try {
      await asana.addComment(gid, plannedHtml(t.dueOn, planningName))
    } catch (e) {
      log('warn', 'bevestiging plaatsen mislukt', { gid, error: e instanceof Error ? e.message : String(e) })
    }
    return 'ingepland'
  }

  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)
    const url = new URL(req.url)
    const token = url.searchParams.get('token') ?? ''
    if (!deps.token || !timingSafeEqual(token, deps.token)) return json({ error: 'Onbekende token' }, 403)
    const resource = url.searchParams.get('resource') ?? ''
    if (!resource) return json({ error: 'resource ontbreekt' }, 400)

    // Handshake bij het aanmaken van de webhook: secret bewaren en teruggeven.
    const hookSecret = req.headers.get('x-hook-secret')
    if (hookSecret) {
      await store.saveSecret(resource, hookSecret)
      log('info', 'webhook-handshake', { resource })
      return new Response(null, { status: 200, headers: { 'X-Hook-Secret': hookSecret } })
    }

    const body = await req.text()
    if (body.length > MAX_BODY_BYTES) return json({ error: 'Te groot' }, 413)
    const signature = req.headers.get('x-hook-signature') ?? ''
    const secrets = await store.getSecrets(resource)
    let valid = false
    for (const s of secrets) {
      if (timingSafeEqual(await hmacHex(s, body), signature)) valid = true
    }
    if (!valid) {
      log('warn', 'webhook met ongeldige handtekening', { resource })
      return json({ error: 'Ongeldige handtekening' }, 401)
    }

    let events: AsanaEvent[] = []
    try {
      events = (JSON.parse(body) as { events?: AsanaEvent[] }).events ?? []
    } catch {
      return json({ error: 'Ongeldige JSON' }, 400)
    }

    const tasks = new Set<string>()
    // Verwijderde taken apart: die kunnen we niet meer opvragen bij Asana, dus de planning-flow heeft
    // er niets te zoeken. Het enige wat telt is dat de aanvraag vervalt.
    const verwijderd = new Set<string>()
    for (const e of events) {
      const gid = e.resource?.gid
      if (!gid || e.resource?.resource_type !== 'task') continue
      // `deleted` is weggegooid, `removed` is uit dit project gehaald. Voor een collega komt dat op
      // hetzelfde neer: de taak staat niet meer op het bord van Marketing.
      if (e.action === 'deleted') verwijderd.add(gid)
      else if (e.action === 'removed' && e.parent?.gid === projectGid) verwijderd.add(gid)
      else if (e.action === 'added' && e.parent?.resource_type === 'section' && e.parent.gid === inPlanning) tasks.add(gid)
      else if (e.action === 'changed') tasks.add(gid)
    }

    const outcomes: Record<string, string> = {}
    for (const gid of verwijderd) {
      // Ook uit de gewone lijst halen: één gebeurtenissenbatch kan allebei bevatten, en een taak
      // ophalen die net weg is levert alleen een fout op.
      tasks.delete(gid)
      try {
        outcomes[gid] = (await deps.markeerVervallen(gid, now())) ? 'aanvraag vervallen' : 'geen aanvraag bij deze taak'
      } catch (e) {
        outcomes[gid] = `fout: ${e instanceof Error ? e.message : String(e)}`
        log('error', 'vervallen markeren mislukt', { gid, error: outcomes[gid] })
      }
    }
    for (const gid of tasks) {
      try {
        outcomes[gid] = await handleTask(gid)
      } catch (e) {
        outcomes[gid] = `fout: ${e instanceof Error ? e.message : String(e)}`
        log('error', 'webhook-taak mislukt', { gid, error: outcomes[gid] })
      }
    }
    if (tasks.size || verwijderd.size) log('info', 'webhook verwerkt', { outcomes })
    return json({ received: events.length, handled: outcomes }, 200)
  }
}
