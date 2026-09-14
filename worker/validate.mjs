#!/usr/bin/env node
/**
 * Stap 3: valideert worker/out/<id>/brand-brief.json tegen shared/brand-brief-schema.ts.
 *   node worker/validate.mjs --aanvraag-id <uuid>   |   --dir worker/out/<map>
 * Exit 0 = geldig (schrijft de genormaliseerde versie terug), exit 1 = ongeldig (fouten op stdout).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brandBriefSchema } from '../shared/brand-brief-schema.ts'
import { outDirFor, parseArgs } from './lib/config.mjs'

const args = parseArgs()
const dir = args.dir ?? (args['aanvraag-id'] ? outDirFor(args['aanvraag-id']) : null)
if (!dir) {
  console.error('Geef --aanvraag-id <uuid> of --dir <map>.')
  process.exit(2)
}
const file = join(dir, 'brand-brief.json')
if (!existsSync(file)) {
  console.error(`Niet gevonden: ${file}`)
  process.exit(1)
}
let raw
try {
  raw = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  console.error(`Geen geldige JSON: ${e.message}`)
  process.exit(1)
}
const result = brandBriefSchema.safeParse(raw)
if (!result.success) {
  console.error('brand-brief.json is ongeldig:')
  for (const issue of result.error.issues) console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  process.exit(1)
}
const brief = result.data

// Zachte checks: kleuren die niet in de signalen voorkomen, logo-index die niet bestaat.
const signalsFile = join(dir, 'signals.json')
if (existsSync(signalsFile)) {
  const signals = JSON.parse(readFileSync(signalsFile, 'utf8'))
  const known = new Set([
    ...signals.colors.brand.map((c) => c.hex),
    ...signals.colors.neutrals.map((c) => c.hex),
    ...signals.colors.cta.map((c) => c.hex),
    ...Object.values(signals.colors.custom_properties ?? {}),
    ...(signals.colors.screenshot_palette ?? []).map((c) => c.hex),
    signals.theme_color,
  ].filter(Boolean).map((h) => String(h).toLowerCase()))
  const unknown = brief.colors.filter((c) => !known.has(c.hex))
  if (unknown.length) console.warn(`Let op: ${unknown.length} kleur(en) staan niet letterlijk in signals.json (${unknown.map((c) => c.hex).join(', ')}). Alleen oké als ze uit de screenshots komen.`)
  if (brief.logo.candidate_index !== null && !signals.logos.some((l) => l.index === brief.logo.candidate_index)) {
    console.error(`logo.candidate_index ${brief.logo.candidate_index} bestaat niet. Beschikbaar: ${signals.logos.map((l) => l.index).join(', ') || 'geen'}`)
    process.exit(1)
  }
}

writeFileSync(file, JSON.stringify(brief, null, 2) + '\n')
console.log(`brand-brief.json is geldig: ${brief.brand_name}, ${brief.colors.length} kleuren, logo ${brief.logo.candidate_index ?? 'geen'}, zekerheid ${Math.round(brief.confidence * 100)}%.`)
