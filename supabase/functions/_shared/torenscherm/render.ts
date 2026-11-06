import jpeg from 'jpeg-js'
import UPNG from 'upng-js'
import { GifReader } from 'omggif'
import { TORENSCHERM_BREEDTE as SW, TORENSCHERM_HOOGTE as SH } from '../shared/torenscherm-preview.ts'

/**
 * Het design op de foto van het torenscherm: een jpg die in de opleveringsmail staat.
 *
 * Het design (jpg, png of gif; van een gif het eerste beeld) wordt passend gemaakt op een scherm
 * van 2112 x 1152, zoals het echte scherm het toont, en in perspectief op de vier opgemeten hoeken
 * van het scherm op de foto gelegd. Per pixel vier monsters, zodat randen en tekst niet kartelen.
 * Daarna een vleugje weerkaatsing van de lucht, zoals op de echte glasplaat.
 *
 * Alles in gewoon JavaScript, binnen de rekentijd van een edge function (een paar honderd ms).
 */

export type Punt = readonly [number, number]

export interface TorenschermFoto {
  breedte: number
  hoogte: number
  /** Het lichtgevende deel van het scherm, in pixels van deze foto: linksboven, rechtsboven, rechtsonder, linksonder. */
  hoeken: readonly Punt[]
  jpegBase64: string
}

export interface Beeld {
  breedte: number
  hoogte: number
  /** RGBA, rij voor rij. */
  rgba: Uint8Array
}

/** Een fout die als reden in de reactie bij de taak komt. */
export class OnleesbaarOntwerp extends Error {}

/** Het design lezen aan de hand van de eerste bytes; de extensie kan liegen. */
export function leesOntwerp(bytes: Uint8Array): Beeld {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const d = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 60, maxMemoryUsageInMB: 400 })
      return { breedte: d.width, hoogte: d.height, rgba: d.data }
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const png = UPNG.decode(bytes.slice().buffer)
      return { breedte: png.width, hoogte: png.height, rgba: new Uint8Array(UPNG.toRGBA8(png)[0]) }
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      const gif = new GifReader(bytes)
      const rgba = new Uint8Array(gif.width * gif.height * 4)
      gif.decodeAndBlitFrameRGBA(0, rgba)
      return { breedte: gif.width, hoogte: gif.height, rgba }
    }
  } catch (e) {
    throw new OnleesbaarOntwerp(`het bestand is niet te lezen (${e instanceof Error ? e.message : String(e)})`)
  }
  throw new OnleesbaarOntwerp('het is geen jpg, png of gif')
}

/** De projectieve afbeelding van het eenheidsvierkant op de vierhoek (Heckbert 1989), als [a b c; d e f; g h 1]. */
export function vierkantNaarVierhoek(h: readonly Punt[]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = h
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  const n = dx1 * dy2 - dx2 * dy1
  const g = n === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / n
  const hh = n === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / n
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1]
}

function inverse([a, b, c, d, e, f, g, h, i]: number[]): number[] {
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det)
}

/** Verkleinen met het gemiddelde van k x k pixels: anders flikkert fijne tekst bij het samplen. */
function verklein(b: Beeld, k: number): Beeld {
  if (k <= 1) return b
  const breedte = Math.floor(b.breedte / k), hoogte = Math.floor(b.hoogte / k)
  const rgba = new Uint8Array(breedte * hoogte * 4)
  const n = k * k
  for (let y = 0; y < hoogte; y++) {
    for (let x = 0; x < breedte; x++) {
      let r = 0, g = 0, bl = 0, a = 0
      for (let dy = 0; dy < k; dy++) {
        let i = ((y * k + dy) * b.breedte + x * k) * 4
        for (let dx = 0; dx < k; dx++, i += 4) {
          r += b.rgba[i]; g += b.rgba[i + 1]; bl += b.rgba[i + 2]; a += b.rgba[i + 3]
        }
      }
      const o = (y * breedte + x) * 4
      rgba[o] = r / n; rgba[o + 1] = g / n; rgba[o + 2] = bl / n; rgba[o + 3] = a / n
    }
  }
  return { breedte, hoogte, rgba }
}

function base64NaarBytes(s: string): Uint8Array {
  const bin = atob(s)
  const uit = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) uit[i] = bin.charCodeAt(i)
  return uit
}

/** De foto één keer uitpakken; een warme function hergebruikt hem. */
const achtergronden = new WeakMap<TorenschermFoto, Beeld>()
function achtergrond(foto: TorenschermFoto): Beeld {
  let b = achtergronden.get(foto)
  if (!b) {
    const d = jpeg.decode(base64NaarBytes(foto.jpegBase64), { useTArray: true, formatAsRGBA: true })
    b = { breedte: d.width, hoogte: d.height, rgba: d.data }
    achtergronden.set(foto, b)
  }
  return b
}

/** Legt het design op het scherm van de foto, in `doel` (een kopie van de foto). */
export function legOpScherm(doel: Beeld, ontwerpIn: Beeld, hoeken: readonly Punt[]): void {
  const xs = hoeken.map((p) => p[0]), ys = hoeken.map((p) => p[1])
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(doel.breedte - 1, Math.ceil(Math.max(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(doel.hoogte - 1, Math.ceil(Math.max(...ys)))

  // Passend op het scherm, met zwart eromheen als de verhouding niet klopt: zo doet het scherm het ook.
  const k = Math.max(1, Math.floor(ontwerpIn.breedte / (2 * (x1 - x0 + 1))))
  const ontwerp = verklein(ontwerpIn, k)
  const s = Math.min(SW / ontwerp.breedte, SH / ontwerp.hoogte)
  const ox = (SW - ontwerp.breedte * s) / 2, oy = (SH - ontwerp.hoogte * s) / 2
  const ow = ontwerp.breedte, oh = ontwerp.hoogte, od = ontwerp.rgba

  const [a, b, c, d, e, f, g, h, i] = inverse(vierkantNaarVierhoek(hoeken))
  const px = doel.rgba
  const kleur = [0, 0, 0]

  /** Kleur van het scherm op (u, v) in 0..1, inclusief glans; false buiten het scherm. */
  const monster = (fx: number, fy: number): boolean => {
    const w = g * fx + h * fy + i
    const u = (a * fx + b * fy + c) / w, v = (d * fx + e * fy + f) / w
    if (u < 0 || u > 1 || v < 0 || v > 1) return false
    const dx = (u * SW - ox) / s - 0.5, dy = (v * SH - oy) / s - 0.5
    let r = 0, gr = 0, bl = 0
    if (dx > -1 && dy > -1 && dx < ow && dy < oh) {
      const cx = Math.min(Math.max(dx, 0), ow - 1), cy = Math.min(Math.max(dy, 0), oh - 1)
      const xa = Math.floor(cx), ya = Math.floor(cy)
      const xb = Math.min(xa + 1, ow - 1), yb = Math.min(ya + 1, oh - 1)
      const tx = cx - xa, ty = cy - ya
      const p00 = (ya * ow + xa) * 4, p10 = (ya * ow + xb) * 4, p01 = (yb * ow + xa) * 4, p11 = (yb * ow + xb) * 4
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty
      // Doorzichtig is zwart: een ledscherm geeft daar geen licht.
      const a00 = od[p00 + 3] / 255 * w00, a10 = od[p10 + 3] / 255 * w10, a01 = od[p01 + 3] / 255 * w01, a11 = od[p11 + 3] / 255 * w11
      r = od[p00] * a00 + od[p10] * a10 + od[p01] * a01 + od[p11] * a11
      gr = od[p00 + 1] * a00 + od[p10 + 1] * a10 + od[p01 + 1] * a01 + od[p11 + 1] * a11
      bl = od[p00 + 2] * a00 + od[p10 + 2] * a10 + od[p01 + 2] * a01 + od[p11 + 2] * a11
    }
    // Weerkaatsing van de lucht rechtsboven, en onderaan een tikje schaduw van de heg.
    const glans = 0.14 * Math.max(0, 1 - Math.hypot(1 - u, v * 1.4) / 1.15)
    const schaduw = 1 - 0.08 * Math.max(0, (v - 0.75) / 0.25)
    kleur[0] = (r * (1 - glans) + 255 * glans) * schaduw
    kleur[1] = (gr * (1 - glans) + 255 * glans) * schaduw
    kleur[2] = (bl * (1 - glans) + 255 * glans) * schaduw
    return true
  }

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * doel.breedte + x) * 4
      let r = 0, gr = 0, bl = 0, binnen = 0
      for (let sy = 0.25; sy < 1; sy += 0.5) {
        for (let sx = 0.25; sx < 1; sx += 0.5) {
          if (monster(x + sx, y + sy)) {
            r += kleur[0]; gr += kleur[1]; bl += kleur[2]; binnen++
          } else {
            r += px[o]; gr += px[o + 1]; bl += px[o + 2]
          }
        }
      }
      if (!binnen) continue
      px[o] = r / 4; px[o + 1] = gr / 4; px[o + 2] = bl / 4
    }
  }
}

/** Het design op de foto, als jpg voor in de mail. */
export function renderTorenscherm(ontwerpBytes: Uint8Array, foto: TorenschermFoto): Uint8Array {
  const ontwerp = leesOntwerp(ontwerpBytes)
  const basis = achtergrond(foto)
  const doel: Beeld = { ...basis, rgba: basis.rgba.slice() }
  legOpScherm(doel, ontwerp, foto.hoeken)
  return jpeg.encode({ data: doel.rgba, width: doel.breedte, height: doel.hoogte }, 85).data
}
