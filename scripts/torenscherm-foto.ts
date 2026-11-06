/**
 * Maakt van de foto van het torenscherm de achtergrond voor de opleveringsmail:
 * snijdt hem bij en zet hem als base64 in supabase/functions/_shared/torenscherm/foto-<locatie>.ts,
 * zodat de edge function hem zonder bestandstoegang kan lezen.
 *
 *   deno run --node-modules-dir=none --allow-read --allow-write scripts/torenscherm-foto.ts
 *
 * Draai dit opnieuw als je de foto of de uitsnede wijzigt. De hoeken van het scherm staan in
 * pixels van de héle foto; dit script rekent ze om naar de uitsnede.
 */
import jpeg from 'npm:jpeg-js@0.4.4'

interface Bron {
  locatie: string
  foto: string
  /** De uitsnede in pixels van de foto: x, y, breedte, hoogte. */
  uitsnede: [number, number, number, number]
  /** Het lichtgevende deel van het scherm, in pixels van de héle foto: linksboven, rechtsboven, rechtsonder, linksonder. */
  hoeken: [number, number][]
}

const BRONNEN: Bron[] = [{
  locatie: 'nbc',
  foto: new URL('./torenscherm/nbc-torenscherm.jpg', import.meta.url).pathname,
  uitsnede: [0, 100, 1320, 880],
  hoeken: [[186.5, 280], [789.5, 402.5], [789.5, 649.3], [186.5, 668.6]],
}]

function naarBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

for (const b of BRONNEN) {
  const heel = jpeg.decode(await Deno.readFile(b.foto), { useTArray: true, formatAsRGBA: true })
  const [ux, uy, uw, uh] = b.uitsnede
  const data = new Uint8Array(uw * uh * 4)
  for (let y = 0; y < uh; y++) {
    const van = ((uy + y) * heel.width + ux) * 4
    data.set(heel.data.subarray(van, van + uw * 4), y * uw * 4)
  }
  const uit = jpeg.encode({ data, width: uw, height: uh }, 90).data
  const hoeken = b.hoeken.map(([x, y]) => [x - ux, y - uy])
  const doel = new URL(`../supabase/functions/_shared/torenscherm/foto-${b.locatie}.ts`, import.meta.url).pathname
  await Deno.writeTextFile(doel, [
    `// Gemaakt door scripts/torenscherm-foto.ts uit scripts/torenscherm/${b.foto.split('/').pop()}. Niet met de hand aanpassen.`,
    `import type { TorenschermFoto } from './render.ts'`,
    ``,
    `export const FOTO: TorenschermFoto = {`,
    `  breedte: ${uw},`,
    `  hoogte: ${uh},`,
    `  hoeken: ${JSON.stringify(hoeken)},`,
    `  jpegBase64: '${naarBase64(uit)}',`,
    `}`,
    ``,
  ].join('\n'))
  console.log(`${doel}: ${uw}x${uh}, ${Math.round(uit.length / 1024)} kB`)
}
