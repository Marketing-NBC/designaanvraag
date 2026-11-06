/**
 * Het rekenwerk achter de torenscherm-preview: JPEG of PNG uitpakken, het design op de foto zetten
 * (zetOpScherm in torenscherm-preview.ts) en het resultaat als JPEG inpakken.
 *
 * Met jpeg-js en fast-png: gewoon JavaScript, zonder WebAssembly of bestanden ernaast, zodat het in
 * een edge function (Deno) en in een script (Node) precies hetzelfde doet. Het kost zo'n halve tot
 * hele seconde rekentijd; daarom draait het in de edge function in een eigen function
 * (torenscherm-preview), los van de opleveringsmail.
 */
import jpeg from 'jpeg-js'
import { convertIndexedToRgb, decode as pngDecode } from 'fast-png'
import { beeldKop, zetOpScherm } from './torenscherm-preview.ts'
import type { Pixels, SchermFoto } from './torenscherm-preview.ts'

/** Kwaliteit van de JPEG in de mail: scherp genoeg voor tekst op het scherm, en rond de 200 KB. */
const KWALITEIT = 85

/** Een JPEG of PNG als pixels (RGBA). Gooit met een leesbare reden als het niet lukt. */
export function decodeerBeeld(bytes: Uint8Array): Pixels {
  const kop = beeldKop(bytes)
  if (!kop) throw new Error('Geen JPEG of PNG')
  if (kop.soort === 'jpeg') {
    let beeld: { width: number; height: number; data: Uint8Array }
    try {
      beeld = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 })
    } catch (e) {
      // Bijvoorbeeld een CMYK-JPEG uit InDesign, of een kapot bestand.
      throw new Error(`De JPEG is niet te lezen (${e instanceof Error ? e.message : String(e)})`)
    }
    return { breedte: beeld.width, hoogte: beeld.height, data: beeld.data }
  }
  const png = pngDecode(bytes)
  if (png.palette) {
    // Een palet: eerst de kleuren erbij zoeken (RGB, of RGBA als het palet doorzichtigheid heeft).
    return { breedte: png.width, hoogte: png.height, data: naarRgba(convertIndexedToRgb(png), png.palette[0]?.length ?? 3, 8) }
  }
  if (png.depth < 8) throw new Error(`Een PNG met ${png.depth} bits per kleur wordt niet ondersteund`)
  return { breedte: png.width, hoogte: png.height, data: naarRgba(png.data, png.channels, png.depth) }
}

/** PNG's zijn er in vele smaken: grijs of kleur, met of zonder alfa, 8 of 16 bits. Alles wordt RGBA, 8 bits. */
function naarRgba(data: ArrayLike<number>, kanalen: number, diepte: number): Uint8Array {
  const n = Math.floor(data.length / kanalen)
  const uit = new Uint8Array(n * 4)
  const schaal = diepte === 16 ? 1 / 257 : 1
  for (let i = 0; i < n; i++) {
    const p = i * kanalen
    let r: number, g: number, b: number, a = 255
    if (kanalen <= 2) {
      r = g = b = data[p] * schaal
      if (kanalen === 2) a = data[p + 1] * schaal
    } else {
      r = data[p] * schaal
      g = data[p + 1] * schaal
      b = data[p + 2] * schaal
      if (kanalen === 4) a = data[p + 3] * schaal
    }
    uit[i * 4] = r
    uit[i * 4 + 1] = g
    uit[i * 4 + 2] = b
    uit[i * 4 + 3] = a
  }
  return uit
}

/** Pixels als JPEG. */
export function encodeerJpeg(beeld: Pixels, kwaliteit = KWALITEIT): Uint8Array {
  const { data } = jpeg.encode({ width: beeld.breedte, height: beeld.hoogte, data: beeld.data }, kwaliteit)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

/**
 * De preview: het design op het scherm van de foto, als JPEG. `foto` mag al uitgepakt zijn (dan
 * hoeft dat niet bij elke mail opnieuw).
 */
export function maakTorenschermPreview(ontwerp: Uint8Array, foto: Pixels, info: SchermFoto): Uint8Array {
  if (foto.breedte !== info.breedte || foto.hoogte !== info.hoogte) {
    throw new Error(`De foto ${info.bestand} is ${foto.breedte} × ${foto.hoogte} px, maar de hoeken zijn opgemeten op ${info.breedte} × ${info.hoogte} px`)
  }
  return encodeerJpeg(zetOpScherm(foto, decodeerBeeld(ontwerp), info.hoeken))
}
