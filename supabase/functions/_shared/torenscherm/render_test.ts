import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'
import jpeg from 'jpeg-js'
import UPNG from 'upng-js'
import { torenschermBeeld } from './mod.ts'
import { OnleesbaarOntwerp, leesOntwerp } from './render.ts'
import { FOTO } from './foto-nbc.ts'

/** Een effen design in één kleur, als png. */
function effenPng(b: number, h: number, [r, g, bl]: [number, number, number]): Uint8Array {
  const rgba = new Uint8Array(b * h * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, bl, 255], i)
  return new Uint8Array(UPNG.encode([rgba.buffer], b, h, 0))
}

function pixel(jpg: Uint8Array, x: number, y: number): number[] {
  const d = jpeg.decode(jpg, { useTArray: true })
  const i = (y * d.width + x) * 4
  return [d.data[i], d.data[i + 1], d.data[i + 2]]
}

const dichtbij = (a: number[], b: number[], marge: number) => a.every((v, i) => Math.abs(v - b[i]) <= marge)

Deno.test('het design komt op het scherm, de rest van de foto blijft', () => {
  const rood = torenschermBeeld(effenPng(211, 115, [220, 20, 30]), 'nbc')
  const blauw = torenschermBeeld(effenPng(211, 115, [20, 30, 220]), 'nbc')
  const d = jpeg.decode(rood, { useTArray: true })
  assertEquals([d.width, d.height], [FOTO.breedte, FOTO.hoogte])

  // Midden van het scherm: de kleur van het design (met een beetje glans en jpg-ruis).
  const midden = pixel(rood, 480, 380)
  assert(midden[0] > 180 && midden[1] < 90 && midden[2] < 90, `midden is ${midden}`)
  assert(pixel(blauw, 480, 380)[2] > 180)
  // Ver buiten het scherm: bij beide designs dezelfde foto.
  assert(dichtbij(pixel(rood, 1200, 800), pixel(blauw, 1200, 800), 6))
  assert(dichtbij(pixel(rood, 100, 60), pixel(blauw, 100, 60), 6))
})

Deno.test('een design in een andere verhouding krijgt zwarte randen, zoals op het scherm', () => {
  // Vierkant: links en rechts op het scherm blijft het zwart.
  const jpg = torenschermBeeld(effenPng(200, 200, [240, 240, 240]), 'nbc')
  const links = pixel(jpg, 230, 380)
  assert(links.every((v) => v < 70), `links is ${links}`)
  assert(pixel(jpg, 480, 380).every((v) => v > 200))
})

Deno.test('jpg, png en gif worden gelezen; de rest niet', () => {
  const png = effenPng(4, 2, [1, 2, 3])
  assertEquals(leesOntwerp(png).breedte, 4)
  const jpg = jpeg.encode({ data: new Uint8Array(4 * 2 * 4), width: 4, height: 2 }, 90).data
  assertEquals(leesOntwerp(jpg).hoogte, 2)
  // Een gif van 1x1 pixel.
  const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='), (c) => c.charCodeAt(0))
  assertEquals(leesOntwerp(gif).breedte, 1)

  assertThrows(() => leesOntwerp(new TextEncoder().encode('%PDF-1.7')), OnleesbaarOntwerp, 'geen jpg, png of gif')
  assertThrows(() => leesOntwerp(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])), OnleesbaarOntwerp, 'niet te lezen')
})

Deno.test('zonder foto van de locatie: een duidelijke fout', () => {
  assertThrows(() => torenschermBeeld(effenPng(4, 2, [0, 0, 0]), 'green_village'), Error, 'geen foto')
})
