import type { AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import { json } from '../_shared/cors.ts'
import type { Db, LedkolomPreviewRow } from '../_shared/db.ts'
import { previewUrl, verslagPreviewKlaar, verslagPreviewMislukt } from '../_shared/shared/ledkolom-preview.ts'

/**
 * Het loket voor de repository NBC-3D-ledkolom-Preview. Die bouwt de 3D-previews van de ledkolom
 * (zie shared/ledkolom-preview.ts) en praat alleen met deze function, met een gedeeld geheim:
 *
 *  - GET                → wat er te bouwen valt: de previews die op "wacht" staan;
 *  - GET ?video=<id>    → doorsturen naar de video in Asana. De downloadlink van Asana is maar een
 *                         paar minuten geldig, dus die halen we pas op het moment dat de build hem
 *                         nodig heeft. Zo hoeft het Asana-token niet in de 3D-repo;
 *  - POST {uitslagen}   → wat er gelukt is, nadat het online staat. Wacht er een opleveringsmail op
 *                         een preview, dan gaat die nu de deur uit (of op Mislukt, met de reden).
 *                         Wacht er niets, dan komt er een reactie bij de taak met de link of de reden.
 */

export interface Deps {
  /** Het geheim dat de 3D-repo meestuurt (LEDKOLOM_SECRET). */
  geheim: string
  db: Pick<Db, 'openLedkolomPreviews' | 'ledkolomPreview' | 'updateLedkolomPreview' | 'wachtendeOpleveringen' | 'findById'>
  asana: Pick<AsanaTaskClient, 'downloadLink' | 'getTask' | 'addComment'>
  /** De opleverflow uit asana-webhook/oplevering.ts. */
  oplever(taak: AsanaTask, opties: { proef: boolean; door: string | null; naPreview: boolean }): Promise<string>
  /** Laat het versturen doorlopen nadat de 3D-repo zijn antwoord heeft. Zonder dit wordt er gewacht. */
  achtergrond?: (werk: Promise<unknown>) => void
  now?: () => Date
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

interface Uitslag {
  id: string
  bijlage: string
  status: 'klaar' | 'mislukt'
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
    if (typeof r?.id !== 'string' || typeof r.bijlage !== 'string' || (r.status !== 'klaar' && r.status !== 'mislukt')) return null
    uit.push({ id: r.id, bijlage: r.bijlage, status: r.status, fout: typeof r.fout === 'string' && r.fout.trim() ? r.fout.trim().slice(0, 500) : null })
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
        ? verslagPreviewKlaar({ naam: r.naam, url: previewUrl(r.slug) })
        : verslagPreviewMislukt(r, r.fout ?? 'Geen reden opgegeven; kijk bij Actions in de 3D-repo.', taak.assignee)
      await asana.addComment(taak.gid, html)
    }
  }

  return async (req) => {
    const auth = req.headers.get('authorization') ?? ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!token || !(await zelfdeGeheim(token, deps.geheim))) return json({ error: 'Geen toegang' }, 401)

    const url = new URL(req.url)

    if (req.method === 'GET' && url.searchParams.has('video')) {
      const rij = await db.ledkolomPreview(url.searchParams.get('video') ?? '')
      if (!rij || rij.status !== 'wacht') return json({ error: 'Deze preview staat niet (meer) klaar om te bouwen' }, 404)
      try {
        const link = await asana.downloadLink(rij.bijlage_gid)
        return new Response(null, { status: 302, headers: { Location: link, 'Cache-Control': 'no-store' } })
      } catch (e) {
        log('error', 'downloadlink video ophalen mislukt', { id: rij.id, error: fout(e) })
        return json({ error: `De video kon niet uit Asana gehaald worden: ${fout(e)}` }, 502)
      }
    }

    if (req.method === 'GET') {
      const open = await db.openLedkolomPreviews()
      return json({
        previews: open.map((r) => ({ id: r.id, slug: r.slug, naam: r.naam, bijlage: r.bijlage_gid, bestandsnaam: r.bestandsnaam })),
      }, 200)
    }

    if (req.method === 'POST') {
      const uitslagen = leesUitslagen(await req.json().catch(() => null))
      if (!uitslagen) return json({ error: 'Verwacht {"uitslagen": [{"id", "bijlage", "status": "klaar"|"mislukt", "fout"?}]}' }, 400)

      const perAanvraag = new Map<string, LedkolomPreviewRow[]>()
      let verouderd = 0
      for (const u of uitslagen) {
        const rij = await db.ledkolomPreview(u.id)
        // Intussen een nieuwe video in de subtaak (of al gemeld): die uitslag geldt niet meer.
        if (!rij || rij.status !== 'wacht' || rij.bijlage_gid !== u.bijlage) {
          verouderd++
          continue
        }
        const patch = u.status === 'klaar'
          ? { status: 'klaar' as const, fout: null, klaar_op: now().toISOString() }
          : { status: 'mislukt' as const, fout: u.fout ?? 'Geen reden opgegeven; kijk bij Actions in de 3D-repo.' }
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
