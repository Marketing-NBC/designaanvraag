import type { AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import { json } from '../_shared/cors.ts'
import type { Db, LedkolomPreviewRow } from '../_shared/db.ts'
import { SLUG, previewUrl, verslagPreviewKlaar, verslagPreviewMislukt } from '../_shared/shared/ledkolom-preview.ts'

/**
 * Het loket voor de repository NBC-3D-ledkolom-Preview. Die maakt de 3D-previews van de ledkolom
 * (zie shared/ledkolom-preview.ts) en praat alleen met deze function, met een gedeeld geheim:
 *
 *  - GET                → welke release-links er klaarstaan: de rijen die op "wacht" staan;
 *  - POST {uitslagen}   → per link welke preview(s) er online staan, of waarom het niet lukte. Wacht
 *                         er een opleveringsmail op, dan gaat die nu de deur uit (of op Mislukt, met
 *                         de reden). Wacht er niets, dan komt er een reactie bij de taak met de link
 *                         of de reden.
 */

export interface Deps {
  /** Het geheim dat de 3D-repo meestuurt (LEDKOLOM_SECRET). */
  geheim: string
  db: Pick<Db, 'openLedkolomPreviews' | 'ledkolomPreview' | 'updateLedkolomPreview' | 'wachtendeOpleveringen' | 'findById'>
  asana: Pick<AsanaTaskClient, 'getTask' | 'addComment'>
  /** De opleverflow uit asana-webhook/oplevering.ts. */
  oplever(taak: AsanaTask, opties: { proef: boolean; door: string | null; naPreview: boolean }): Promise<string>
  /** Laat het versturen doorlopen nadat de 3D-repo zijn antwoord heeft. Zonder dit wordt er gewacht. */
  achtergrond?: (werk: Promise<unknown>) => void
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

interface Uitslag {
  id: string
  bron: string
  status: 'klaar' | 'mislukt'
  previews: { naam: string; slug: string }[]
  fout: string | null
}

const fout = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Vergelijkt zonder vroeg te stoppen, zodat de tijd niets over het geheim verraadt. */
async function zelfdeGeheim(a: string, b: string): Promise<boolean> {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = await Promise.all([hash(a), hash(b)])
  let verschil = 0
  for (let i = 0; i < x.length; i++) verschil |= x[i] ^ y[i]
  return verschil === 0
}

function leesUitslagen(body: unknown): Uitslag[] | null {
  const lijst = (body as { uitslagen?: unknown } | null)?.uitslagen
  if (!Array.isArray(lijst) || lijst.length > 50) return null
  const uit: Uitslag[] = []
  for (const u of lijst) {
    const r = u as Record<string, unknown>
    if (typeof r?.id !== 'string' || typeof r.bron !== 'string' || (r.status !== 'klaar' && r.status !== 'mislukt')) return null
    // Alleen wat als link op GitHub Pages kan: een naam en een map zoals build.mjs die maakt.
    const ruw = Array.isArray(r.previews) ? r.previews.slice(0, 20) : []
    const previews = ruw
      .map((p) => p as Record<string, unknown>)
      .filter((p) => typeof p?.slug === 'string' && SLUG.test(p.slug) && typeof p.naam === 'string')
      .map((p) => ({ naam: String(p.naam).slice(0, 200), slug: String(p.slug) }))
    if (previews.length !== ruw.length) return null
    uit.push({ id: r.id, bron: r.bron, status: r.status, previews, fout: typeof r.fout === 'string' && r.fout.trim() ? r.fout.trim().slice(0, 500) : null })
  }
  return uit
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const { db, asana } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))

  /** Na een melding: een wachtende mail versturen, of anders Marketing laten weten hoe het ging. */
  async function nazorg(aanvraagId: string, rijen: LedkolomPreviewRow[]): Promise<void> {
    const aanvraag = await db.findById(aanvraagId)
    if (!aanvraag?.asana_task_gid) {
      log('warn', '3D-preview zonder Asana-taak', { aanvraag: aanvraagId })
      return
    }
    const taak = await asana.getTask(aanvraag.asana_task_gid)
    const wachtend = await db.wachtendeOpleveringen(aanvraagId)
    if (wachtend.length) {
      for (const w of wachtend) {
        const uitkomst = await deps.oplever(taak, { proef: false, door: w.door, naPreview: true })
        log('info', 'wachtende oplevermail', { aanvraag: aanvraagId, uitkomst })
      }
      return
    }
    for (const r of rijen) {
      const html = r.status === 'klaar'
        ? verslagPreviewKlaar(r.previews.map((p) => ({ naam: p.naam, url: previewUrl(p.slug) })))
        : verslagPreviewMislukt(r.bron, r.fout ?? 'Geen reden opgegeven; kijk bij Actions in de 3D-repo.', taak.assignee)
      await asana.addComment(taak.gid, html)
    }
  }

  return async (req) => {
    const auth = req.headers.get('authorization') ?? ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!token || !(await zelfdeGeheim(token, deps.geheim))) return json({ error: 'Geen toegang' }, 401)

    if (req.method === 'GET') {
      const open = await db.openLedkolomPreviews()
      return json({ releases: open.map((r) => ({ id: r.id, bron: r.bron })) }, 200)
    }

    if (req.method === 'POST') {
      const uitslagen = leesUitslagen(await req.json().catch(() => null))
      if (!uitslagen) return json({ error: 'Verwacht {"uitslagen": [{"id", "bron", "status": "klaar"|"mislukt", "previews"?: [{"naam", "slug"}], "fout"?}]}' }, 400)

      const perAanvraag = new Map<string, LedkolomPreviewRow[]>()
      let verouderd = 0
      for (const u of uitslagen) {
        const rij = await db.ledkolomPreview(u.id)
        // Al gemeld, of niet van deze link: die uitslag geldt niet (meer).
        if (!rij || rij.status !== 'wacht' || rij.bron !== u.bron) {
          verouderd++
          continue
        }
        const patch = u.status === 'klaar' && u.previews.length
          ? { status: 'klaar' as const, fout: null, previews: u.previews, klaar_op: now().toISOString() }
          : { status: 'mislukt' as const, fout: u.fout ?? 'Er kwam geen preview uit; kijk bij Actions in de 3D-repo.' }
        await db.updateLedkolomPreview(rij.id, patch)
        perAanvraag.set(rij.aanvraag_id, [...(perAanvraag.get(rij.aanvraag_id) ?? []), { ...rij, ...patch }])
      }

      const werk = Promise.all([...perAanvraag].map(([aanvraagId, rijen]) =>
        nazorg(aanvraagId, rijen).catch((e) => log('error', 'nazorg 3D-preview mislukt', { aanvraag: aanvraagId, error: fout(e) }))
      ))
      if (deps.achtergrond) deps.achtergrond(werk)
      else await werk

      log('info', '3D-preview gemeld', { verwerkt: uitslagen.length - verouderd, verouderd })
      return json({ verwerkt: uitslagen.length - verouderd, verouderd }, 200)
    }

    return json({ error: 'Methode niet toegestaan' }, 405)
  }
}
