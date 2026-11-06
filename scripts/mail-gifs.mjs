#!/usr/bin/env node
/**
 * De lijst van gifjes voor de mails: wat er in de mappen van web/public/mail-gifs/ staat. Draait bij
 * de deploy naar GitHub Pages (.github/workflows/deploy-pages.yml), zodat een gifje dat iemand in
 * een map zet vanzelf in de mails komt. Zie shared/mail-gifs.ts.
 *
 *   node --experimental-strip-types --no-warnings scripts/mail-gifs.mjs [--klein] [--schrijf]
 *
 * Opties:
 *   --klein    Maak te grote gifjes kleiner (breder dan 480, hoger dan 360 of groter dan 900 KB),
 *              met gifsicle. Alleen in de kopie van de deploy: de bestanden in de repo blijven zoals
 *              ze zijn.
 *   --schrijf  Schrijf de lijst als gifs.json in web/public/mail-gifs/, zodat hij meegaat naar Pages.
 *
 * Zonder opties laat hij alleen zien wat er staat. Een bestand dat geen gif is, of een map die niet
 * bij een mail hoort, komt niet in de lijst; dat staat dan in de uitvoer.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GIF_LIJST, GIF_MAPPEN, MAX_GIF_BREEDTE, MAX_GIF_HOOGTE } from '../shared/mail-gifs.ts'

export const GIF_MAP = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'mail-gifs')
const MAX_BYTES = 900_000

/** Breedte en hoogte uit de kop van een gif, of null als het geen gif is. */
export function gifMaat(bytes) {
  if (bytes.length < 10) return null
  const kop = String.fromCharCode(...bytes.subarray(0, 6))
  if (kop !== 'GIF87a' && kop !== 'GIF89a') return null
  return { breedte: bytes[6] | (bytes[7] << 8), hoogte: bytes[8] | (bytes[9] << 8) }
}

/** Wat er in de mappen staat: de lijst, en wat er niet in kon. */
export function leesGifs(map = GIF_MAP) {
  const lijst = {}
  const overgeslagen = []
  if (!existsSync(map)) return { lijst, overgeslagen }
  for (const naam of readdirSync(map).sort()) {
    const pad = join(map, naam)
    if (!statSync(pad).isDirectory()) continue
    if (!GIF_MAPPEN.includes(naam)) {
      overgeslagen.push(`${naam}/: geen map van een mail (wel: ${GIF_MAPPEN.join(', ')})`)
      continue
    }
    for (const bestand of readdirSync(pad).sort()) {
      if (bestand.startsWith('.') || /\.md$/i.test(bestand)) continue
      const maat = gifMaat(readFileSync(join(pad, bestand)))
      if (!/\.gif$/i.test(bestand) || !maat) {
        overgeslagen.push(`${naam}/${bestand}: geen gif`)
        continue
      }
      ;(lijst[naam] ??= []).push({ bestand: `${naam}/${bestand}`, ...maat })
    }
  }
  return { lijst, overgeslagen }
}

/** Maakt de te grote gifjes kleiner, met gifsicle. Geeft terug welke. */
function maakKlein(map, lijst) {
  const gedaan = []
  for (const g of Object.values(lijst).flat()) {
    const pad = join(map, g.bestand)
    const voor = statSync(pad).size
    if (g.breedte <= MAX_GIF_BREEDTE && g.hoogte <= MAX_GIF_HOOGTE && voor <= MAX_BYTES) continue
    // Eerst alleen kleiner en zuiniger; is het dan nog te groot, dan minder kleuren en nog kleiner.
    // Lukt 900 KB dan nog niet, dan blijft de laatste poging staan: groot, maar het werkt.
    const vol = `${MAX_GIF_BREEDTE}x${MAX_GIF_HOOGTE}`
    for (const [maat, ...extra] of [[vol, '--lossy=80'], [vol, '--lossy=140', '--colors', '96'], ['360x270', '--lossy=200', '--colors', '64']]) {
      execFileSync('gifsicle', ['--resize-fit', maat, '-O3', ...extra, pad, '-o', `${pad}.klein`])
      if (statSync(`${pad}.klein`).size <= MAX_BYTES) break
    }
    execFileSync('mv', [`${pad}.klein`, pad])
    Object.assign(g, gifMaat(readFileSync(pad)))
    gedaan.push(`${g.bestand}: ${Math.round(voor / 1000)} KB → ${Math.round(statSync(pad).size / 1000)} KB, ${g.breedte}×${g.hoogte}`)
  }
  return gedaan
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { lijst, overgeslagen } = leesGifs()
  if (process.argv.includes('--klein')) {
    for (const regel of maakKlein(GIF_MAP, lijst)) console.log(`Kleiner gemaakt: ${regel}`)
  }
  for (const map of GIF_MAPPEN) console.log(`${map}: ${(lijst[map] ?? []).map((g) => g.bestand.split('/')[1]).join(', ') || '(leeg)'}`)
  for (const regel of overgeslagen) console.log(`::warning::Overgeslagen: ${regel}`)
  if (process.argv.includes('--schrijf')) {
    writeFileSync(join(GIF_MAP, GIF_LIJST), `${JSON.stringify(lijst, null, 2)}\n`)
    console.log(`Geschreven: web/public/mail-gifs/${GIF_LIJST}`)
  }
}
