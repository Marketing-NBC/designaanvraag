#!/usr/bin/env node
/**
 * Leest het Asana-project van Abel uit en schrijft shared/asana-fields.json:
 * project-gid, assignee-gid (optioneel) en de gids van custom fields + enum-opties,
 * gekoppeld aan onze veldsleutels via scripts/asana-field-map.json.
 *
 * Met --aanmaken wordt eerst aangevuld wat er in Asana nog niet staat: velden uit
 * scripts/asana-velden.mjs die in het project ontbreken, en ontbrekende opties op
 * bestaande keuzelijsten. Zonder die vlag leest dit script alleen uit, en dan is een
 * veld dat nog niet in Asana staat (de knop "Menuscherm" was dat) niet meer dan een
 * regel onderaan de workflow - die zie je over het hoofd.
 *
 * Gebruik:
 *   ASANA_PAT=... node scripts/asana-fields.mjs --project <gid of url> [--aanmaken] [--assignee "Abel"] [--planning <gid of url>]
 *
 * Draait ook in de workflow .github/workflows/asana-fields.yml.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { veldsleutels, zorgVoorVelden } from './asana-velden.mjs'

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

/** Praat met Asana en gooit bij een fout; zo kan zorgVoorVelden per veld opvangen wat misgaat. */
async function asana(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`Asana ${method} ${path} → ${res.status}: ${json?.errors?.map((e) => e.message).join('; ') ?? 'onbekende fout'}`)
    err.status = res.status
    throw err
  }
  return json.data
}

/** Uitlezen dat niet mag mislukken: zonder deze gegevens heeft de rest geen zin. */
async function lees(path) {
  try {
    return await asana(path)
  } catch (e) {
    return fail(e.message)
  }
}

const project = await lees(`/projects/${projectGid}?opt_fields=name,gid,permalink_url,workspace.gid,workspace.name,members.name,members.gid`)

const warnings = []
/** Velden die in de map staan maar niet in Asana: daar kan de function niets mee. */
const ontbrekend = []
const norm = (s) => String(s ?? '').trim().toLowerCase()
const planningGid = args.planning && args.planning !== 'true' ? extractGid(args.planning) : null

// Eerst aanvullen wat er in Asana nog niet staat. Zonder deze stap kon een veld dat we
// later bedachten - de knop "Menuscherm" - er maanden uit blijven: het stond wel in
// asana-field-map.json, maar uitlezen maakt een veld niet aan.
if (args.aanmaken && args.aanmaken !== 'false') {
  const gezorgd = await zorgVoorVelden({
    asana, map, workspaceGid: project.workspace?.gid, projectGid, planningGid,
  })
  for (const line of gezorgd.summary) console.log(line)
  warnings.push(...gezorgd.warnings)
}

const settings = await lees(
  `/projects/${projectGid}/custom_field_settings?limit=100&opt_fields=custom_field.gid,custom_field.name,custom_field.resource_subtype,custom_field.enum_options.gid,custom_field.enum_options.name,custom_field.enum_options.enabled`,
)

const asanaFields = settings.map((s) => s.custom_field)

const out = { generated_at: new Date().toISOString(), project: { gid: project.gid, name: project.name, url: project.permalink_url, workspace_gid: project.workspace?.gid }, assignee: null, fields: {}, sections: {}, planning_project: null }

for (const key of veldsleutels(map)) {
  const wanted = map[key]
  const f = asanaFields.find((x) => norm(x.name) === norm(wanted))
  if (!f) {
    ontbrekend.push(wanted)
    warnings.push(`Veld "${wanted}" (${key}) niet gevonden in het project. Beschikbaar: ${asanaFields.map((x) => x.name).join(', ') || 'geen'}`)
    continue
  }
  const entry = { gid: f.gid, name: f.name, type: f.resource_subtype }
  if (f.resource_subtype === 'enum' || f.resource_subtype === 'multi_enum') {
    entry.options = {}
    const enabled = (f.enum_options ?? []).filter((o) => o.enabled !== false)
    if (key === 'aanvrager') {
      // Bewust géén opties opslaan: dit bestand staat in een publieke repo en namen van collega's
      // horen daar niet in. De edge function zoekt de optie bij het indienen op via de API en maakt
      // hem zo nodig aan.
      entry.opties_via_function = true
      delete entry.options
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

// Bord-kolommen (sleutel → gid), op naam uit asana-field-map.json.
const sections = await lees(`/projects/${projectGid}/sections?opt_fields=name`)
for (const [key, name] of Object.entries(map.sections ?? {})) {
  const s = sections.find((x) => norm(x.name) === norm(name))
  if (s) out.sections[key] = { gid: s.gid, name: s.name }
  else warnings.push(`Sectie "${name}" (${key}) niet gevonden. Aanwezig: ${sections.map((x) => x.name).join(', ') || 'geen'}`)
}

// Planningsproject: daar komen taken ook in zodra Marketing een vervaldatum kiest.
if (args.planning && args.planning !== 'true') {
  if (!planningGid) warnings.push(`Kan geen project-gid halen uit "${args.planning}".`)
  else {
    const p = await lees(`/projects/${planningGid}?opt_fields=name,gid,permalink_url`)
    out.planning_project = { gid: p.gid, name: p.name, url: p.permalink_url }
  }
}

if (args.assignee && args.assignee !== 'true') {
  const member = (project.members ?? []).find((m) => norm(m.name).includes(norm(args.assignee)))
  if (member) out.assignee = { gid: member.gid, name: member.name }
  else warnings.push(`Geen projectlid gevonden met "${args.assignee}". Leden: ${(project.members ?? []).map((m) => m.name).join(', ')}`)
}

const target = resolve(root, 'shared/asana-fields.json')
writeFileSync(target, JSON.stringify({ _comment: 'Gegenereerd door scripts/asana-fields.mjs. Niet met de hand bewerken.', ...out }, null, 2) + '\n')
console.log(`Geschreven: ${target}`)
console.log(`Project: ${project.name} (${project.gid})`)
console.log(`Velden gekoppeld: ${Object.keys(out.fields).join(', ') || 'geen'}`)
if (out.assignee) console.log(`Assignee gevonden (${out.assignee.gid})`)
console.log(`Secties gekoppeld: ${Object.keys(out.sections).join(', ') || 'geen'}`)
if (out.planning_project) console.log(`Planningsproject: ${out.planning_project.name} (${out.planning_project.gid})`)

// Waarschuwingen moeten in de workflow te zien zijn zonder het logboek open te klappen.
// Dat ging eerder mis: console.warn gaat naar stderr en de workflow zette alleen stdout
// in de samenvatting, dus "Veld Menuscherm niet gevonden" viel buiten beeld. Nu wordt
// het een annotatie bovenaan de run en een blok in de samenvatting.
for (const w of warnings) console.warn(`Let op: ${w}`)
for (const naam of ontbrekend) {
  console.log(`::error title=Asana-veld ontbreekt::Veld "${naam}" staat niet in het project. `
    + 'Draai deze workflow met "Ontbrekende velden aanmaken" aan, of maak het veld met de hand in Asana.')
}
for (const w of warnings.filter((w) => !ontbrekend.some((n) => w.includes(`"${n}"`)))) {
  console.log(`::warning title=Asana-velden::${w}`)
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const regels = [`## Asana-velden`, '', `[${project.name}](${project.permalink_url})`, '',
    `- Velden gekoppeld: ${Object.keys(out.fields).join(', ') || 'geen'}`,
    `- Secties gekoppeld: ${Object.keys(out.sections).join(', ') || 'geen'}`]
  if (out.assignee) regels.push(`- Assignee: ${out.assignee.name}`)
  if (out.planning_project) regels.push(`- Planningsproject: ${out.planning_project.name}`)
  if (ontbrekend.length) {
    regels.push('', `> [!CAUTION]`, `> Deze velden staan nog niet in Asana: **${ontbrekend.join('**, **')}**.`,
      '> Zolang ze ontbreken doet de function er niets mee.')
  }
  if (warnings.length) regels.push('', '**Let op**', '', ...warnings.map((w) => `- ${w}`))
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, regels.join('\n') + '\n')
}

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
