import { readFileSync } from 'node:fs'
import sharp from 'sharp'
const SP = '/tmp/claude-0/-home-user-designaanvraag/1afa8b26-74ba-50c2-a779-eca6a4869137/scratchpad'
const P = JSON.parse(readFileSync(`${SP}/ref/plaatsingen.json`, 'utf8'))

console.log('naam          verh   Abel b x h      kader-opp   inktdekking   inkt-opp bij Abels maat')
console.log('-'.repeat(96))
const rijen = []
for (const [naam, v] of Object.entries(P)) {
  const { data, info } = await sharp(`${SP}/ref/${naam}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let inkt = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 24) inkt++
  const dekking = inkt / (info.width * info.height)
  const kader = v.abel.breedte * v.abel.hoogte
  rijen.push({ naam, verh: v.verhouding, ...v.abel, kader, dekking, inktOpp: kader * dekking })
}
for (const r of rijen.sort((a, b) => b.verh - a.verh)) {
  console.log(`${r.naam.padEnd(13)}${String(r.verh).padEnd(7)}${String(Math.round(r.breedte)).padStart(5)} x${String(Math.round(r.hoogte)).padStart(5)}`
    + `${Math.round(r.kader).toLocaleString('nl').padStart(14)}${(r.dekking*100).toFixed(1).padStart(12)}%${Math.round(r.inktOpp).toLocaleString('nl').padStart(20)}`)
}
const i = rijen.map((r) => r.inktOpp), k = rijen.map((r) => r.kader)
const sp = (a) => `${Math.round(Math.min(...a)).toLocaleString('nl')} – ${Math.round(Math.max(...a)).toLocaleString('nl')} (factor ${(Math.max(...a)/Math.min(...a)).toFixed(1)})`
console.log(`\nspreiding kader-oppervlak: ${sp(k)}`)
console.log(`spreiding inkt-oppervlak : ${sp(i)}`)
