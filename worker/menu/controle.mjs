import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { WORKER_DIR, parseArgs, log } from '../lib/config.mjs'
import { renderMenu, pakketten, laadBasis, inhoudVanBasis } from './render.mjs'

const MENU_DIR = join(WORKER_DIR, 'menu')
const BASIS_DIR = join(MENU_DIR, 'basis')
const REFERENTIE_DIR = join(BASIS_DIR, 'referentie')

const DREMPEL = 24      // kleurverschil waarboven een pixel als afwijkend telt
const INKT = 200        // onder deze helderheid noemen we een pixel bedrukt

/**
 * Vergelijkt een render met de pagina uit het Illustrator-bestand.
 *
 * Er zijn drie soorten verschil, en die zeggen heel verschillende dingen:
 *   verplaatst  tekst staat op een andere plek dan in het basisontwerp - fout
 *   zwaarte     dezelfde tekst op dezelfde plek, maar dunner of dikker gezet
 *   rest        alles wat overblijft
 * Een verschil telt als "zwaarte" wanneer er in de directe omgeving van de pixel
 * in beide beelden inkt zit; dan staat de letter goed en scheelt alleen de snit.
 */
async function vergelijk(renderPng, referentiePad) {
  const a = await sharp(renderPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(referentiePad).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: B, height: H } = a.info
  if (b.info.width !== B || b.info.height !== H) {
    throw new Error(`Formaten verschillen: ${B}x${H} tegen ${b.info.width}x${b.info.height}`)
  }

  const inktA = new Uint8Array(B * H)
  const inktB = new Uint8Array(B * H)
  for (let p = 0; p < B * H; p++) {
    const i = p * 4
    inktA[p] = (a.data[i] * 299 + a.data[i + 1] * 587 + a.data[i + 2] * 114) / 1000 < INKT ? 1 : 0
    inktB[p] = (b.data[i] * 299 + b.data[i + 1] * 587 + b.data[i + 2] * 114) / 1000 < INKT ? 1 : 0
  }
  const inBuurt = (inkt, x, y, straal) => {
    for (let dy = -straal; dy <= straal; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= H) continue
      for (let dx = -straal; dx <= straal; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= B) continue
        if (inkt[yy * B + xx]) return true
      }
    }
    return false
  }

  const diff = Buffer.alloc(B * H * 3, 255)
  let verplaatst = 0
  let zwaarte = 0
  let rest = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < B; x++) {
      const p = y * B + x
      const i = p * 4
      const verschil = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]))
      if (verschil <= DREMPEL) continue
      const d = p * 3
      if (inktA[p] || inktB[p]) {
        const beide = inBuurt(inktA, x, y, 2) && inBuurt(inktB, x, y, 2)
        if (beide) {
          zwaarte++
          diff[d] = 255; diff[d + 1] = 190; diff[d + 2] = 60      // oranje: alleen de snit
        } else {
          verplaatst++
          diff[d] = 220; diff[d + 1] = 30; diff[d + 2] = 30       // rood: staat verkeerd
        }
      } else {
        rest++
        diff[d] = 60; diff[d + 1] = 110; diff[d + 2] = 220        // blauw: vlakwerk
      }
    }
  }
  const totaal = B * H
  return {
    verplaatst, zwaarte, rest,
    procentVerplaatst: (100 * verplaatst) / totaal,
    procentZwaarte: (100 * zwaarte) / totaal,
    procentRest: (100 * rest) / totaal,
    diff: await sharp(diff, { raw: { width: B, height: H, channels: 3 } }).png().toBuffer(),
  }
}

export async function controleer(namen, uitDir) {
  const uitslagen = []
  for (const pakket of namen) {
    const referentie = join(REFERENTIE_DIR, `${pakket}.png`)
    if (!existsSync(referentie)) {
      log(`${pakket}: geen referentiebeeld - draai eerst worker/menu/basis-extract.py`)
      continue
    }

    // Drie wegen naar hetzelfde beeld, alle drie tegen het Illustrator-bestand gelegd:
    //   kaal    het basisontwerp zoals het bevroren is
    //   rond    hetzelfde ontwerp, maar via het invoerformaat waarin aanvragen
    //           binnenkomen - wie het sjabloon ongewijzigd terugstuurt hoort
    //           precies het basisontwerp te krijgen
    //   herbouw hetzelfde ontwerp, maar met de regelval opnieuw uitgerekend in
    //           plaats van overgenomen. Dit is wat er gebeurt zodra een gerecht
    //           wijzigt, en het toetst of de kolombreedtes kloppen voor het font
    //           dat wij zetten (Hairline) en niet alleen voor dat van het .ai (Thin).
    const kaal = await renderMenu({ pakket })
    const rond = await renderMenu(inhoudVanBasis(laadBasis(pakket)))
    const herbouw = await renderMenu({ pakket, forceerHerberekening: true })
    const uitslagKaal = await vergelijk(kaal.png, referentie)
    const uitslagRond = await vergelijk(rond.png, referentie)
    const uitslagHerbouw = await vergelijk(herbouw.png, referentie)

    if (uitDir) {
      mkdirSync(uitDir, { recursive: true })
      writeFileSync(join(uitDir, `${pakket}.png`), kaal.png)
      writeFileSync(join(uitDir, `${pakket}-verschil.png`), uitslagKaal.diff)
    }
    uitslagen.push({ pakket, ...uitslagKaal, viaInvoer: uitslagRond, bijHerbouw: uitslagHerbouw,
                     herbouwMeldingen: herbouw.meldingen,
                     meldingen: kaal.meldingen, fonts: kaal.fonts })

    log(`${pakket.padEnd(22)} verplaatst ${uitslagKaal.procentVerplaatst.toFixed(3)}%  `
      + `snit ${uitslagKaal.procentZwaarte.toFixed(3)}%  `
      + `vlakwerk ${uitslagKaal.procentRest.toFixed(3)}%  `
      + `via invoer ${uitslagRond.procentVerplaatst.toFixed(3)}%  `
      + `bij herberekening ${uitslagHerbouw.procentVerplaatst.toFixed(3)}%  `
      + `botsingen ${kaal.meldingen.botsingen.length}`)
    for (const m of kaal.meldingen.structuur) log(`   structuur: ${m}`)
    for (const m of kaal.meldingen.overloop) log(`   overloop: ${m}`)
    for (const m of kaal.meldingen.botsingen) log(`   botsing: "${m.tekst}" op y=${m.baseline}`)
    for (const m of rond.meldingen.regelval) log(`   regelval via invoer: ${m}`)
    for (const m of herbouw.meldingen.regelval) log(`   andere regelval bij herberekening: ${m}`)
    for (const m of herbouw.meldingen.opmaak) log(`   let op: ${m}`)
  }
  return uitslagen
}

// CLI: node worker/menu/controle.mjs [--pakket naam] [--uit map]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs()
  const namen = args.pakket ? [args.pakket] : pakketten()
  const uitDir = args.uit || join(MENU_DIR, 'out')
  log(`Controle van ${namen.length} basisontwerp(en) tegen het Illustrator-bestand`)
  const uitslagen = await controleer(namen, uitDir)

  // Bij herberekening kijken we naar de regelval en niet naar het pixelverschil:
  // een alinea met eigen opmaak per regel is nu eenmaal niet uit platte tekst te
  // herbouwen, en die staat apart gemeld.
  const stuk = uitslagen.filter((u) => u.procentVerplaatst > 0.02
    || u.viaInvoer.procentVerplaatst > 0.02
    || u.herbouwMeldingen.regelval.length
    || u.meldingen.botsingen.length)
  log('')
  if (stuk.length === 0) {
    log('Alle basisontwerpen komen 1:1 uit de opmaak-engine.')
  } else {
    log(`Aandacht nodig: ${stuk.map((u) => u.pakket).join(', ')}`)
  }
  log(`Beelden staan in ${uitDir}`)
}
