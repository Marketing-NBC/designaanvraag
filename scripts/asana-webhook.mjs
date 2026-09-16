#!/usr/bin/env node
/**
 * Registreert (idempotent) de Asana-webhook van het project "Designaanvragen" op de edge function
 * asana-webhook. Draait in de Supabase-deploy-workflow, na het deployen van de functions.
 *
 *   ASANA_PAT=... node scripts/asana-webhook.mjs --target https://<ref>.supabase.co/functions/v1/asana-webhook
 *
 * De token in de webhook-URL is afgeleid van ASANA_PAT (sha256), zodat de function en dit script
 * dezelfde waarde kennen zonder extra secret. De volledige URL wordt nooit gelogd.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const API = process.env.ASANA_API ?? 'https://app.asana.com/api/1.0'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)

const pat = process.env.ASANA_PAT
if (!pat) fail('ASANA_PAT ontbreekt (env).')
const base = String(args.target ?? '').replace(/\/$/, '')
if (!/^https:\/\//.test(base) && !process.env.ASANA_API) fail('Geef --target https://…/functions/v1/asana-webhook')

const cfg = JSON.parse(readFileSync(resolve(here, '../shared/asana-fields.json'), 'utf8'))
const projectGid = cfg.project?.gid
const workspaceGid = cfg.project?.workspace_gid
if (!projectGid || !workspaceGid) fail('shared/asana-fields.json heeft geen project; draai eerst "Asana-project aanmaken" of "Asana-velden vernieuwen".')
if (!cfg.sections?.in_planning) console.warn('Let op: sectie "In planning" ontbreekt in asana-fields.json; draai "Asana-project aanmaken" opnieuw.')

const token = createHash('sha256').update(`asana-webhook:${pat}`).digest('hex').slice(0, 32)
const target = `${base}?resource=${projectGid}&token=${token}`
const masked = `${base}?resource=${projectGid}&token=***`

const existing = await asana(`/webhooks?workspace=${workspaceGid}&resource=${projectGid}&limit=100&opt_fields=target,active,resource.gid`)
// Alles wat naar een asana-webhook-function wijst is van ons, ook die van een ouder Supabase-project.
// Zo blijven er na een verhuizing geen webhooks achter die naar een dood (of ander) project leveren.
const mine = existing.filter((w) => /\/functions\/v1\/asana-webhook(\?|$)/.test(String(w.target ?? '')))
const current = mine.find((w) => w.target === target && w.active !== false)
for (const w of mine) {
  if (w === current) continue
  await asana(`/webhooks/${w.gid}`, { method: 'DELETE' })
  console.log(`Oude webhook verwijderd (${w.gid})`)
}
if (current) {
  console.log(`Webhook bestond al (${current.gid}) → ${masked}`)
  process.exit(0)
}

// De handshake kan net na een deploy nog falen (function herstart, secrets nog niet door); een paar keer proberen.
let created = null
for (let attempt = 1; attempt <= 4 && !created; attempt++) {
  try {
    created = await asana('/webhooks', {
      method: 'POST',
      body: {
        data: {
          resource: projectGid,
          target,
          filters: [
            { resource_type: 'task', action: 'added' },
            { resource_type: 'task', action: 'changed' },
            // Verwijderd of uit het project gehaald: dan vervalt de aanvraag in de applicatie.
            { resource_type: 'task', action: 'deleted' },
            { resource_type: 'task', action: 'removed' },
          ],
        },
      },
    })
  } catch (e) {
    const msg = String(e.message).replace(token, '***')
    if (attempt === 4) fail(`Webhook aanmaken mislukt: ${msg}`)
    console.log(`Poging ${attempt} mislukt (${msg}); opnieuw over 15 s…`)
    await new Promise((r) => setTimeout(r, 15_000))
  }
}
console.log(`Webhook aangemaakt (${created.gid}) → ${masked}`)

async function asana(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Asana ${method} ${path} → ${res.status}: ${json?.errors?.map((e) => e.message).join('; ') ?? 'onbekende fout'}`)
  return json.data
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
