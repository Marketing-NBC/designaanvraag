import { SCHERM_FOTOS } from './shared/torenscherm-preview.ts'
import type { Locatie } from './shared/request-types.ts'

/**
 * Maakt de torenscherm-preview voor de opleveringsmail (zie shared/torenscherm-preview.ts).
 *
 * Het rekenwerk (JPEG uitpakken, in perspectief zetten, weer inpakken) kost zo'n seconde rekentijd.
 * Een edge function mag per verzoek maar 2 seconden rekenen; loopt hij daaroverheen, dan wordt hij
 * gestopt, en dan zou de opleveringsmail halverwege blijven hangen. Daarom gebeurt het in een eigen
 * function, torenscherm-preview, met zijn eigen 2 seconden. Gaat het daar mis, dan krijgt de mail
 * gewoon een gifje.
 */
export interface TorenschermMaker {
  /** De preview als JPEG. Gooit met een leesbare reden als het niet lukt. */
  maak(ontwerp: Uint8Array, locatie: Locatie): Promise<Uint8Array>
}

/**
 * Het sleuteltje tussen asana-webhook en torenscherm-preview: afgeleid van de secret key van het
 * project, die beide al hebben. Zo hoeft er geen extra secret te worden ingesteld, en reist de
 * secret key zelf niet mee.
 */
export async function torenschermSleutel(secretKey: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`torenscherm-preview:${secretKey}`))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const SLEUTEL_HEADER = 'x-torenscherm-sleutel'

type Fetch = typeof fetch

export function createTorenschermMaker(supabaseUrl: string, secretKey: string, doFetch: Fetch = fetch): TorenschermMaker {
  const sleutel = torenschermSleutel(secretKey)
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/torenscherm-preview`
  return {
    async maak(ontwerp, locatie) {
      if (!SCHERM_FOTOS[locatie]) throw new Error(`Er is geen foto van het torenscherm van ${locatie}`)
      const res = await doFetch(`${url}?locatie=${encodeURIComponent(locatie)}`, {
        method: 'POST',
        headers: { [SLEUTEL_HEADER]: await sleutel, 'Content-Type': 'application/octet-stream' },
        body: ontwerp as Uint8Array<ArrayBuffer>,
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; msg?: string }
        // 546 is Supabase die de function stopte, bijvoorbeeld omdat hij te lang rekende.
        const reden = body.error ?? (res.status === 546 ? 'het rekenwerk duurde te lang' : body.msg ?? `fout ${res.status}`)
        throw new Error(reden)
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('er kwam geen JPEG terug')
      return bytes
    },
  }
}
