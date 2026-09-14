#!/usr/bin/env node
/**
 * Leest het Asana-project van Abel uit en schrijft shared/asana-fields.json:
 * project-gid, assignee-gid (optioneel) en de gids van custom fields + enum-opties,
 * gekoppeld aan onze veldsleutels via scripts/asana-field-map.json.
 *
 * Gebruik:
 *   ASANA_PAT=... node scripts/asana-fields.mjs --project <gid of url> [--assignee "Abel"]
 *
 * Draait ook in de workflow .github/workflows/asana-fields.yml.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const API = 'https://app.asana.com/api/1.0'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)

const pat = process.env.ASANA_PAT
if (!pat) fail('ASANA_PAT ontbreekt (env).')
const projectArg = args.project ?? process.env.ASANA_PROJECT
if (!projectArg) fail('Geef --project <gid of link naar het project>.')
const projectGid = extractGid(projectArg)
if (!projectGid) fail(`Kan geen project-gid halen uit "${projectArg}".`)

const map = JSON.parse(readFileSync(resolve(here, 'asana-field-map.json'), 'utf8'))

async function asana(path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) fail(`Asana ${path} → ${res.status}: ${body?.errors?.map((e) => e.message).join('; ') ?? 'onbekende fout'}`)
  return body.data
}

const project = await asana(`/projects/${projectGid}?opt_fields=name,gid,permalink_url,workspace.gid,workspace.name,members.name,members.gid`)
const settings = await asana(
  `/projects/${projectGid}/custom_field_settings?limit=100&opt_fields=custom_field.gid,custom_field.name,custom_field.resource_subtype,custom_field.enum_options.gid,custom_field.enum_options.name,custom_field.enum_options.enabled`,
)

const asanaFields = settings.map((s) => s.custom_field)
const norm = (s) => String(s ?? '').trim().toLowerCase()

const out = { generated_at: new Date().toISOString(), project: { gid: project.gid, name: project.name, url: project.permalink_url, workspace_gid: project.workspace?.gid }, assignee: null, fields: {} }
const warnings = []

for (const [key, wanted] of Object.entries(map)) {
  if (key.startsWith('_') || key === 'option_aliases') continue
  const f = asanaFields.find((x) => norm(x.name) === norm(wanted))
  if (!f) {
    warnings.push(`Veld "${wanted}" (${key}) niet gevonden in het project. Beschikbaar: ${asanaFields.map((x) => x.name).join(', ') || 'geen'}`)
    continue
  }
  const entry = { gid: f.gid, name: f.name, type: f.resource_subtype }
  if (f.resource_subtype === 'enum' || f.resource_subtype === 'multi_enum') {
    entry.options = {}
    const enabled = (f.enum_options ?? []).filter((o) => o.enabled !== false)
    if (key === 'aanvrager') {
      // Namen van collega's: één op één op label.
      for (const o of enabled) entry.options[o.name] = o.gid
    } else {
      for (const [ourKey, aliases] of Object.entries(map.option_aliases ?? {})) {
        const hit = enabled.find((o) => aliases.some((a) => norm(a) === norm(o.name)))
        if (hit) entry.options[ourKey] = hit.gid
      }
      const unmatched = enabled.filter((o) => !Object.values(entry.options).includes(o.gid)).map((o) => o.name)
      if (unmatched.length) warnings.push(`Veld "${f.name}": opties zonder koppeling: ${unmatched.join(', ')}`)
    }
  }
  out.fields[key] = entry
}

if (args.assignee) {
  const member = (project.members ?? []).find((m) => norm(m.name).includes(norm(args.assignee)))
  if (member) out.assignee = { gid: member.gid, name: member.name }
  else warnings.push(`Geen projectlid gevonden met "${args.assignee}". Leden: ${(project.members ?? []).map((m) => m.name).join(', ')}`)
}

const target = resolve(root, 'shared/asana-fields.json')
writeFileSync(target, JSON.stringify({ _comment: 'Gegenereerd door scripts/asana-fields.mjs. Niet met de hand bewerken.', ...out }, null, 2) + '\n')
console.log(`Geschreven: ${target}`)
console.log(`Project: ${project.name} (${project.gid})`)
console.log(`Velden gekoppeld: ${Object.keys(out.fields).join(', ') || 'geen'}`)
if (out.assignee) console.log(`Assignee: ${out.assignee.name} (${out.assignee.gid})`)
for (const w of warnings) console.warn(`Let op: ${w}`)

function extractGid(s) {
  const str = String(s).trim()
  // Nieuw formaat: https://app.asana.com/1/<workspace>/project/<project>/…
  const nieuw = str.match(/\/project\/(\d{6,})/)
  if (nieuw) return nieuw[1]
  // Oud formaat: https://app.asana.com/0/<project>/<task>
  const oud = str.match(/\/0\/(\d{6,})/)
  if (oud) return oud[1]
  // Kale gid
  const m = str.match(/(\d{6,})/)
  return m ? m[1] : null
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
