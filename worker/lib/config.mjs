import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_DIR = resolve(WORKER_DIR, '..')
export const OUT_DIR = process.env.BRAND_OUT_DIR ? resolve(process.env.BRAND_OUT_DIR) : join(WORKER_DIR, 'out')

/** Chromium van de Claude Code-cloudomgeving als die er is; anders Playwright's eigen browser. */
export function chromiumExecutable() {
  const pre = process.env.PW_EXECUTABLE ?? '/opt/pw-browsers/chromium'
  return existsSync(pre) ? pre : undefined
}

export function env(name, fallback = null) {
  const v = process.env[name]?.trim()
  return v ? v : fallback
}

export function requireEnv(name) {
  const v = env(name)
  if (!v) throw new Error(`Omgevingsvariabele ${name} ontbreekt`)
  return v
}

export function outDirFor(key) {
  const safe = String(key).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80)
  const dir = join(OUT_DIR, safe)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Eenvoudige argv-parser: --key value / --flag. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
    } else out[key] = true
  }
  return out
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function log(msg, extra) {
  const t = new Date().toISOString().slice(11, 19)
  console.log(`[${t}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`)
}
