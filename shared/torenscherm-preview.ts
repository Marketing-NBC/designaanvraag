/**
 * De torenscherm-preview in de opleveringsmail.
 *
 * Bij een aanvraag met een torenscherm krijgt de aanvrager bovenaan de mail geen gifje, maar een
 * foto van het torenscherm aan de gevel van NBC met het opgeleverde design erop. Zo ziet hij meteen
 * hoe het er buiten uitziet, in plaats van alleen een plat bestand.
 *
 * Het design is gewoon een bijlage in de subtaak Oplevering (een JPEG of PNG van 2112 × 1152 px).
 * Die gaat zoals altijd mee als bijlage; daarnaast zetten we hem in perspectief op het scherm van de
 * foto in web/public/torenscherm/. De foto staat op GitHub Pages, net als de gifjes.
 *
 * Puur: bytes en pixels erin, keuzes en pixels eruit, zonder pakketten. Decoderen en encoderen van
 * JPEG en PNG doet de webhook (supabase/functions/_shared/torenscherm.ts).
 */
import { FORMULIER_URL } from './contact.ts'
import type { Locatie, RequestTypeKey } from './request-types.ts'

/** De maat van een torenscherm-design. */
export const TORENSCHERM_BREEDTE = 2112
export const TORENSCHERM_HOOGTE = 1152

/**
 * Hoe ver de verhouding van een bijlage van 2112 : 1152 mag afwijken om als torenscherm te gelden.
 * Krap, zodat een 16:9-scherm (koffiescherm, 3 % smaller) in dezelfde oplevering niet meedoet. Staat
 * "toren" in de bestandsnaam, dan mag het ruimer: dan weten we het zeker.
 */
const VERHOUDING_MARGE = 0.02
const VERHOUDING_MARGE_OP_NAAM = 0.15

/** Meer previews dan dit maakt de mail alleen maar lang; de rest staat in de bijlagen. */
export const MAX_TORENSCHERM_PREVIEWS = 3

/**
 * Grotere bestanden pakken we niet uit: het rekenwerk moet binnen de tijd van een edge function
 * blijven. Een torenscherm-design is een paar MB; dit is ruim.
 */
export const MAX_ONTWERP_BYTES = 12 * 1024 * 1024
export const MAX_ONTWERP_PIXELS = 4500 * 2500

export type Punt = readonly [number, number]

/** Waar het scherm op de foto staat, in pixels van de foto: linksboven, rechtsboven, rechtsonder, linksonder. */
export interface Hoeken {
  lb: Punt
  rb: Punt
  ro: Punt
  lo: Punt
}

/** Een foto met het torenscherm erop, en waar het scherm staat. */
export interface SchermFoto {
  /** Pad vanaf de map torenscherm/ op GitHub Pages. */
  bestand: string
  breedte: number
  hoogte: number
  hoeken: Hoeken
  /** Staat er als het plaatje in de mail niet laadt. */
  alt: string
}

/**
 * Per locatie de foto. Alleen NBC heeft er (nog) een; bij Green Village gaat de mail met een gifje,
 * zoals altijd. Een foto toevoegen: zie web/public/torenscherm/README.md.
 */
export const SCHERM_FOTOS: Partial<Record<Locatie, SchermFoto>> = {
  nbc: {
    bestand: 'nbc-torenscherm.jpg',
    breedte: 1120,
    hoogte: 747,
    // Opgemeten op de foto: de rand van het verlichte deel, binnen de zwarte omlijsting.
    hoeken: { lb: [126.5, 146], rb: [729, 259], ro: [730, 516], lo: [127.5, 533] },
    alt: 'Je design op het torenscherm bij de ingang van NBC',
  },
}

/** Waar de foto's online staan: de map torenscherm naast het formulier. */
export const SCHERM_FOTO_BASIS = `${FORMULIER_URL}torenscherm/`

/** Krijgt deze oplevering een torenscherm-preview? Alleen bij een torenscherm, en als er een foto van de locatie is. */
export function heeftTorenschermPreview(types: readonly RequestTypeKey[] | null | undefined, locatie: Locatie | null | undefined): boolean {
  return (types ?? []).includes('torenscherm') && Boolean(locatie && SCHERM_FOTOS[locatie])
}

export type BeeldSoort = 'jpeg' | 'png'

/**
 * Soort en maat uit de eerste bytes van een JPEG of PNG, zonder hem uit te pakken. Null als het
 * geen van beide is, of als de kop niet te lezen is.
 */
export function beeldKop(bytes: Uint8Array): { soort: BeeldSoort; breedte: number; hoogte: number } | null {
  // PNG: vaste handtekening, daarna meteen het IHDR-blok met breedte en hoogte.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const breedte = dv.getUint32(16)
    const hoogte = dv.getUint32(20)
    return breedte && hoogte ? { soort: 'png', breedte, hoogte } : null
  }
  // JPEG: langs de blokken tot het SOF-blok, daar staat de maat.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null
      const marker = bytes[i + 1]
      if (marker === 0xff) {
        i++
        continue
      }
      // Blokken zonder lengte.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const lengte = (bytes[i + 2] << 8) | bytes[i + 3]
      // SOF0..SOF15, behalve DHT (C4), JPG (C8) en DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const hoogte = (bytes[i + 5] << 8) | bytes[i + 6]
        const breedte = (bytes[i + 7] << 8) | bytes[i + 8]
        return breedte && hoogte ? { soort: 'jpeg', breedte, hoogte } : null
      }
      if (lengte < 2) return null
      i += 2 + lengte
    }
  }
  return null
}

/** Is dit beeld een torenscherm-design? Op de verhouding, of ruimer als "toren" in de naam staat. */
export function isTorenschermBeeld(naam: string, breedte: number, hoogte: number): boolean {
  if (!(breedte > 0 && hoogte > 0)) return false
  const afwijking = Math.abs(breedte / hoogte / (TORENSCHERM_BREEDTE / TORENSCHERM_HOOGTE) - 1)
  return afwijking <= (/toren/i.test(naam) ? VERHOUDING_MARGE_OP_NAAM : VERHOUDING_MARGE)
}

/**
 * Welke bijlagen een preview worden: JPEG's en PNG's met de maat van een torenscherm, in de volgorde
 * van de bijlagen, hooguit MAX_TORENSCHERM_PREVIEWS. Te grote bestanden slaan we over.
 */
export function kiesTorenschermOntwerpen<T extends { naam: string; bytes: Uint8Array }>(bijlagen: readonly T[]): T[] {
  return bijlagen.filter((b) => {
    if (b.bytes.length > MAX_ONTWERP_BYTES) return false
    const kop = beeldKop(b.bytes)
    if (!kop || kop.breedte * kop.hoogte > MAX_ONTWERP_PIXELS) return false
    return isTorenschermBeeld(b.naam, kop.breedte, kop.hoogte)
  }).slice(0, MAX_TORENSCHERM_PREVIEWS)
}

/** Pixels, vier bytes per pixel (rood, groen, blauw, alfa), rij na rij. */
export interface Pixels {
  breedte: number
  hoogte: number
  data: Uint8Array | Uint8ClampedArray
}

/**
 * De projectieve afbeelding van het eenheidsvierkant op de vier hoeken (Heckbert): (u, v) in [0, 1]²
 * wordt x = (a·u + b·v + c) / (g·u + h·v + 1), en y net zo met d, e, f.
 */
export function vierkantNaarHoeken(h: Hoeken): number[] {
  const [x0, y0] = h.lb, [x1, y1] = h.rb, [x2, y2] = h.ro, [x3, y3] = h.lo
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  let g = 0, hh = 0
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2
    const noemer = dx1 * dy2 - dx2 * dy1
    if (Math.abs(noemer) < 1e-12) throw new Error('De hoeken van het scherm liggen op één lijn')
    g = (sx * dy2 - dx2 * sy) / noemer
    hh = (dx1 * sy - sx * dy1) / noemer
  }
  return [
    x1 - x0 + g * x1, x3 - x0 + hh * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + hh * y3, y0,
    g, hh, 1,
  ]
}

/** De omgekeerde 3×3-matrix (via de geadjugeerde; de schaal doet er bij een projectie niet toe). */
export function omgekeerd(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  return [
    e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d,
  ]
}

/** Een pixel van de foto naar (u, v) op het scherm: (0, 0) linksboven, (1, 1) rechtsonder. */
export function fotoNaarScherm(inv: number[], x: number, y: number): [number, number] {
  const w = inv[6] * x + inv[7] * y + inv[8]
  return [(inv[0] * x + inv[1] * y + inv[2]) / w, (inv[3] * x + inv[4] * y + inv[5]) / w]
}

/**
 * Verkleint met gemiddelden over blokjes van `factor` × `factor` pixels. Scherper en rustiger dan
 * punten prikken: een design van 2112 px breed komt op de foto zo'n 600 px breed.
 */
export function verklein(bron: Pixels, factor: number): Pixels {
  const k = Math.max(1, Math.floor(factor))
  if (k === 1) return bron
  const breedte = Math.max(1, Math.floor(bron.breedte / k))
  const hoogte = Math.max(1, Math.floor(bron.hoogte / k))
  const data = new Uint8Array(breedte * hoogte * 4)
  const n = k * k
  const som = new Float64Array(breedte * 4)
  for (let ty = 0; ty < hoogte; ty++) {
    som.fill(0)
    for (let dy = 0; dy < k; dy++) {
      const rij = (ty * k + dy) * bron.breedte * 4
      for (let tx = 0; tx < breedte; tx++) {
        let p = rij + tx * k * 4
        const s = tx * 4
        for (let dx = 0; dx < k; dx++, p += 4) {
          som[s] += bron.data[p]
          som[s + 1] += bron.data[p + 1]
          som[s + 2] += bron.data[p + 2]
          som[s + 3] += bron.data[p + 3]
        }
      }
    }
    const uit = ty * breedte * 4
    for (let j = 0; j < breedte * 4; j++) data[uit + j] = Math.round(som[j] / n)
  }
  return { breedte, hoogte, data }
}

/** Zoveel monsters per pixel, in elke richting: gladde randen en geen trapjes in schuine tekst. */
const MONSTERS = 3

/**
 * Zet het design in perspectief op het scherm van de foto. Past het design niet precies in de
 * verhouding van het scherm, dan wordt het een fractie uitgerekt; dat zie je bij 2 % niet. Een
 * doorzichtig deel van een PNG wordt zwart, zoals een led-scherm dat is als het uit staat.
 * De foto zelf blijft heel: het resultaat is een nieuwe set pixels.
 */
export function zetOpScherm(foto: Pixels, ontwerp: Pixels, hoeken: Hoeken): Pixels {
  const uit = new Uint8Array(foto.data)
  const punten = [hoeken.lb, hoeken.rb, hoeken.ro, hoeken.lo]
  const afstand = (p: Punt, q: Punt) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const schermBreedte = Math.max(afstand(hoeken.lb, hoeken.rb), afstand(hoeken.lo, hoeken.ro))
  const schermHoogte = Math.max(afstand(hoeken.lb, hoeken.lo), afstand(hoeken.rb, hoeken.ro))
  // Eerst verkleinen tot ongeveer twee keer de maat op de foto; de monsters doen de rest.
  const bron = verklein(ontwerp, Math.min(ontwerp.breedte / (2 * schermBreedte), ontwerp.hoogte / (2 * schermHoogte)))
  const bw = bron.breedte, bh = bron.hoogte, bd = bron.data

  const inv = omgekeerd(vierkantNaarHoeken(hoeken))
  const x0 = Math.max(0, Math.floor(Math.min(...punten.map((p) => p[0]))))
  const x1 = Math.min(foto.breedte - 1, Math.ceil(Math.max(...punten.map((p) => p[0]))))
  const y0 = Math.max(0, Math.floor(Math.min(...punten.map((p) => p[1]))))
  const y1 = Math.min(foto.hoogte - 1, Math.ceil(Math.max(...punten.map((p) => p[1]))))
  const totaal = MONSTERS * MONSTERS

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let r = 0, g = 0, b = 0, raak = 0
      for (let sy = 0; sy < MONSTERS; sy++) {
        const py = y + (sy + 0.5) / MONSTERS
        for (let sx = 0; sx < MONSTERS; sx++) {
          const px = x + (sx + 0.5) / MONSTERS
          const w = inv[6] * px + inv[7] * py + inv[8]
          const u = (inv[0] * px + inv[1] * py + inv[2]) / w
          const v = (inv[3] * px + inv[4] * py + inv[5]) / w
          if (u < 0 || u > 1 || v < 0 || v > 1) continue
          // Bilineair tussen de vier dichtstbijzijnde pixels van het (verkleinde) design.
          const fx = Math.min(bw - 1, Math.max(0, u * bw - 0.5))
          const fy = Math.min(bh - 1, Math.max(0, v * bh - 0.5))
          const ix = Math.min(bw - 2, Math.floor(fx)), iy = Math.min(bh - 2, Math.floor(fy))
          const tx = bw > 1 ? fx - ix : 0, ty = bh > 1 ? fy - iy : 0
          const p00 = (Math.max(0, iy) * bw + Math.max(0, ix)) * 4
          const p10 = p00 + (bw > 1 ? 4 : 0)
          const p01 = p00 + (bh > 1 ? bw * 4 : 0)
          const p11 = p01 + (bw > 1 ? 4 : 0)
          const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty
          // Alfa telt mee als dekking: een doorzichtig stuk is een zwart scherm.
          const a00 = bd[p00 + 3] / 255, a10 = bd[p10 + 3] / 255, a01 = bd[p01 + 3] / 255, a11 = bd[p11 + 3] / 255
          r += w00 * a00 * bd[p00] + w10 * a10 * bd[p10] + w01 * a01 * bd[p01] + w11 * a11 * bd[p11]
          g += w00 * a00 * bd[p00 + 1] + w10 * a10 * bd[p10 + 1] + w01 * a01 * bd[p01 + 1] + w11 * a11 * bd[p11 + 1]
          b += w00 * a00 * bd[p00 + 2] + w10 * a10 * bd[p10 + 2] + w01 * a01 * bd[p01 + 2] + w11 * a11 * bd[p11 + 2]
          raak++
        }
      }
      if (!raak) continue
      // Aan de rand van het scherm valt maar een deel van de monsters erop: daar mengen met de foto.
      const p = (y * foto.breedte + x) * 4
      const rest = totaal - raak
      uit[p] = Math.round((r + rest * foto.data[p]) / totaal)
      uit[p + 1] = Math.round((g + rest * foto.data[p + 1]) / totaal)
      uit[p + 2] = Math.round((b + rest * foto.data[p + 2]) / totaal)
      uit[p + 3] = 255
    }
  }
  return { breedte: foto.breedte, hoogte: foto.hoogte, data: uit }
}

/**
 * De preview zoals hij in de mail komt: als bijlage in de mail zelf, met een verwijzing in de HTML.
 * Breedte en hoogte zijn die van het bestand; in de mail staat hij even groot als een gifje.
 */
export interface TorenschermPreview {
  /** De Content-ID waarmee de HTML naar de bijlage verwijst (`cid:…`). */
  cid: string
  breedte: number
  hoogte: number
  alt: string
}
