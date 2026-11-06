import { json } from '../_shared/cors.ts'
import { SLEUTEL_HEADER } from '../_shared/torenscherm.ts'
import { MAX_ONTWERP_BYTES, SCHERM_FOTOS } from '../_shared/shared/torenscherm-preview.ts'
import type { Pixels, SchermFoto } from '../_shared/shared/torenscherm-preview.ts'
import type { Locatie } from '../_shared/shared/request-types.ts'

/**
 * Zet een torenscherm-design op de foto van het torenscherm (zie shared/torenscherm-preview.ts).
 * Alleen voor asana-webhook en ledkolom-preview, die hem aanroepen bij het versturen van een
 * opleveringsmail; zie _shared/torenscherm.ts voor waarom dit een eigen function is.
 *
 *   POST ?locatie=nbc, body: de bytes van het design (JPEG of PNG)
 *   → 200 met de preview als JPEG, of een fout met {error} als reden.
 */
export interface Deps {
  /** Wat asana-webhook meestuurt in de header x-torenscherm-sleutel (torenschermSleutel). */
  sleutel: string
  /** De foto van het torenscherm, uitgepakt. */
  foto(info: SchermFoto): Promise<Pixels>
  /** Het rekenwerk: maakTorenschermPreview uit shared/torenscherm-render.ts. */
  maak(ontwerp: Uint8Array, foto: Pixels, info: SchermFoto): Uint8Array
  log?: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void
}

const fout = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Vergelijkt zonder vroeg te stoppen, zodat de tijd niets over de sleutel verraadt. */
function zelfde(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b)
  let verschil = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) verschil |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return verschil === 0
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((level, msg, extra) => console[level === 'info' ? 'log' : level](msg, extra ?? ''))

  return async (req) => {
    const sleutel = req.headers.get(SLEUTEL_HEADER) ?? ''
    if (!sleutel || !zelfde(sleutel, deps.sleutel)) return json({ error: 'Geen toegang' }, 401)
    if (req.method !== 'POST') return json({ error: 'Methode niet toegestaan' }, 405)

    const locatie = new URL(req.url).searchParams.get('locatie') as Locatie | null
    const info = locatie ? SCHERM_FOTOS[locatie] : undefined
    if (!info) return json({ error: `Er is geen foto van het torenscherm van ${locatie ?? '(geen locatie)'}` }, 400)

    const ontwerp = new Uint8Array(await req.arrayBuffer())
    if (!ontwerp.length) return json({ error: 'Er kwam geen design mee' }, 400)
    if (ontwerp.length > MAX_ONTWERP_BYTES) return json({ error: 'Het design is te groot om er een preview van te maken' }, 413)

    let foto: Pixels
    try {
      foto = await deps.foto(info)
    } catch (e) {
      log('error', 'foto van het torenscherm ophalen mislukt', { bestand: info.bestand, error: fout(e) })
      return json({ error: `De foto van het torenscherm kon niet worden opgehaald (${fout(e)})` }, 502)
    }

    const start = performance.now()
    try {
      const jpeg = deps.maak(ontwerp, foto, info)
      log('info', 'torenscherm-preview gemaakt', { locatie, bytes: jpeg.length, ms: Math.round(performance.now() - start) })
      return new Response(jpeg as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } })
    } catch (e) {
      log('warn', 'torenscherm-preview maken mislukt', { locatie, error: fout(e) })
      return json({ error: fout(e) }, 422)
    }
  }
}
