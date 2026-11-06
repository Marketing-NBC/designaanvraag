import { readEnv } from '../_shared/env.ts'
import { torenschermSleutel } from '../_shared/torenscherm.ts'
import { SCHERM_FOTO_BASIS } from '../_shared/shared/torenscherm-preview.ts'
import type { Pixels } from '../_shared/shared/torenscherm-preview.ts'
import { decodeerBeeld, maakTorenschermPreview } from '../_shared/shared/torenscherm-render.ts'
import { createHandler } from './handler.ts'

const env = readEnv()

/**
 * De foto staat op GitHub Pages, naast het formulier (web/public/torenscherm/). Uitgepakt bewaren
 * we hem zolang de function warm is: dat scheelt bij een tweede mail een tiende seconde rekenen.
 * Mislukt het ophalen, dan proberen we het bij de volgende mail gewoon opnieuw.
 */
const fotos = new Map<string, Promise<Pixels>>()
function foto(bestand: string): Promise<Pixels> {
  let p = fotos.get(bestand)
  if (!p) {
    p = (async () => {
      const res = await fetch(new URL(bestand, SCHERM_FOTO_BASIS), { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`${res.status} bij ${bestand}`)
      return decodeerBeeld(new Uint8Array(await res.arrayBuffer()))
    })()
    p.catch(() => fotos.delete(bestand))
    fotos.set(bestand, p)
  }
  return p
}

const handler = createHandler({
  sleutel: await torenschermSleutel(env.supabaseSecretKey),
  foto: (info) => foto(info.bestand),
  maak: maakTorenschermPreview,
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('torenscherm-preview: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis' }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  }
})
