#!/usr/bin/env node
/**
 * Kopieert shared/*.ts en shared/asana-fields.json naar supabase/functions/_shared/shared/,
 * zodat de edge functions dezelfde schema's gebruiken zonder buiten hun map te importeren.
 * Draai na elke wijziging in shared/ (CI controleert of de kopie actueel is: --check).
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'shared')
const dst = join(root, 'supabase', 'functions', '_shared', 'shared')
const check = process.argv.includes('--check')

const files = readdirSync(src).filter((f) => (f.endsWith('.ts') && !f.endsWith('.test.ts')) || f === 'asana-fields.json')

if (check) {
  let stale = false
  for (const f of files) {
    try {
      if (readFileSync(join(src, f), 'utf8') !== readFileSync(join(dst, f), 'utf8')) stale = true
    } catch {
      stale = true
    }
  }
  if (stale) {
    console.error('supabase/functions/_shared/shared is niet actueel. Draai: node scripts/sync-shared.mjs')
    process.exit(1)
  }
  console.log('shared-kopie is actueel.')
} else {
  rmSync(dst, { recursive: true, force: true })
  mkdirSync(dst, { recursive: true })
  for (const f of files) copyFileSync(join(src, f), join(dst, f))
  console.log(`Gekopieerd naar ${dst}: ${files.join(', ')}`)
}
