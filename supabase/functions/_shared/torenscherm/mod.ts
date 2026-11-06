import type { Locatie } from '../shared/request-types.ts'
import { FOTO as NBC } from './foto-nbc.ts'
import { renderTorenscherm, type TorenschermFoto } from './render.ts'

/** De foto per locatie; zie TORENSCHERM_LOCATIES in shared/torenscherm-preview.ts, die moet hiermee kloppen. */
const FOTOS: Partial<Record<Locatie, TorenschermFoto>> = { nbc: NBC }

/** Het design op de foto van het torenscherm van deze locatie, als jpg. */
export function torenschermBeeld(ontwerp: Uint8Array, locatie: Locatie): Uint8Array {
  const foto = FOTOS[locatie]
  if (!foto) throw new Error(`er is geen foto van het torenscherm van ${locatie}`)
  return renderTorenscherm(ontwerp, foto)
}
