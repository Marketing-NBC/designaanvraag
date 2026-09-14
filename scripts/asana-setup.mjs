#!/usr/bin/env node
/**
 * Maakt in Asana een project aan voor designaanvragen, met secties en de custom fields die
 * de edge function invult (namen uit scripts/asana-field-map.json). Veilig om opnieuw te draaien:
 * bestaande project, secties, velden en opties worden hergebruikt.
 *
 * Gebruik:
 *   ASANA_PAT=... node scripts/asana-setup.mjs --like <link of gid van een bestaand project> \
 *     [--name "Designaanvragen"] [--assignee "Abel"] [--team <gid>] [--planning <link of gid>]
 *
 * --like bepaalt workspace, team en leden (die worden overgenomen). Daarna:
 *   node scripts/asana-fields.mjs --project <nieuwe gid> --assignee "Abel"
 * Draait ook in de workflow .github/workflows/asana-setup.yml.
 */
import { appendFileSync, readFileSync } from 'node:fs'
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
const likeGid = args.like ? extractGid(args.like) : null
if (!likeGid) fail('Geef --like <link of gid van een bestaand project> (bepaalt workspace en team).')
const projectName = String(args.name ?? 'Designaanvragen').trim()
const assigneeName = args.assignee && args.assignee !== 'true' ? String(args.assignee) : null

const map = JSON.parse(readFileSync(resolve(here, 'asana-field-map.json'), 'utf8'))
const norm = (s) => String(s ?? '').trim().toLowerCase()
const warnings = []
const summary = []

// Velden zoals de edge function ze invult (zie supabase/functions/_shared/asana.ts → buildCustomFields).
const FIELD_SPECS = [
  { key: 'eventdatum', type: 'date', description: 'Datum van het event.' },
  { key: 'deadline', type: 'date', description: 'Wanneer de aanvrager het design uiterlijk nodig heeft. De vervaldatum van de taak kiest Marketing zelf bij het inplannen.' },
  {
    key: 'aanvrager',
    type: 'enum',
    description: 'Collega die de aanvraag heeft ingediend. Een keuzelijst, zodat het dashboard erop kan groeperen.',
    // Geen vaste opties: de edge function maakt de optie aan zodra iemand voor het eerst een
    // aanvraag doet. Zo staan er geen namen van collega's in deze (publieke) repo.
    optiesViaFunction: true,
    // Dit veld was eerder een tekstveld; Asana kan het type niet wijzigen, dus vervangen.
    vervangBijAnderType: true,
  },
  {
    key: 'type',
    type: 'multi_enum',
    description: 'Wat er is aangevraagd.',
    options: [
      ['led_kolom', 'blue'],
      ['torenscherm', 'aqua'],
      ['koffiescherm', 'blue-green'],
      ['overige_schermen', 'indigo'],
      ['menukaart_print', 'yellow-orange'],
      ['menu_scherm', 'orange'],
      ['vlaggen', 'green'],
      ['anders', 'cool-gray'],
    ],
  },
  {
    key: 'modus',
    type: 'enum',
    description: 'Volledig custom ontwerp of de standaard NBC-templates.',
    options: [
      ['custom', 'purple'],
      ['standaard', 'green'],
    ],
  },
  { key: 'website', type: 'text', description: 'Website van de opdrachtgever of het event (bron voor de huisstijl).' },
  { key: 'schijf', type: 'text', description: 'Locatie op de G-schijf met meer informatie of bestaande designs.' },
  {
    key: 'spoed',
    type: 'enum',
    description: 'Minder dan 10 werkdagen tussen de aanvraag en het event. Wordt automatisch gezet bij het indienen.',
    // De optiekleuren bepalen ook de kleur bij "kleuren op veld" in de kalender van de werkplanning:
    // spoedjes rood, de rest neutraal grijs zodat alleen spoed opvalt.
    options: [
      ['ja', 'red'],
      ['nee', 'cool-gray'],
    ],
    /** Dit veld hoort ook in het planningsproject, anders kun je daar niet op kleuren. */
    ookInPlanning: true,
  },
]

const SECTIONS = Object.values(map.sections ?? { a: 'Nieuwe aanvragen', b: 'In planning', c: 'Mee bezig', d: 'Klaar' })

// 1. Workspace, team en leden van het voorbeeldproject
const like = await asana(
  `/projects/${likeGid}?opt_fields=name,workspace.gid,workspace.name,workspace.is_organization,team.gid,team.name,members.gid,members.name`,
)
const workspaceGid = like.workspace.gid
const teamGid = args.team && args.team !== 'true' ? String(args.team) : like.team?.gid ?? null
if (like.workspace.is_organization && !teamGid) fail(`Workspace "${like.workspace.name}" is een organisatie; geef --team <gid>.`)
summary.push(`Workspace: ${like.workspace.name} (${workspaceGid})${teamGid ? `, team: ${like.team?.name ?? teamGid}` : ''}`)

// 2. Project: bestaand hergebruiken of aanmaken
const listPath = teamGid ? `/teams/${teamGid}/projects` : `/workspaces/${workspaceGid}/projects`
const existing = (await asana(`${listPath}?archived=false&limit=100&opt_fields=name,permalink_url`)).find((p) => norm(p.name) === norm(projectName))
let project
if (existing) {
  project = await asana(`/projects/${existing.gid}?opt_fields=name,gid,permalink_url,members.gid,members.name`)
  summary.push(`Project bestond al: ${project.name} (${project.gid})`)
} else {
  const data = {
    workspace: workspaceGid,
    name: projectName,
    color: 'dark-teal',
    default_view: 'board',
    notes:
      'Aanvragen uit het designaanvraag-formulier (https://marketing-nbc.github.io/designaanvraag/). ' +
      'Elke aanvraag wordt hier automatisch een taak, met de gegevens in de velden en de beschrijving. ' +
      'De huisstijl van de opdrachtgever (logo, kleuren, fonts) volgt binnen een paar minuten als bijlage en comment.',
  }
  if (teamGid) data.team = teamGid
  project = await asana('/projects', { method: 'POST', body: { data } })
  project = await asana(`/projects/${project.gid}?opt_fields=name,gid,permalink_url,members.gid,members.name`)
  summary.push(`Project aangemaakt: ${project.name} (${project.gid})`)
}

// 3. Leden overnemen van het voorbeeldproject (zodat het marketingteam het project ziet)
const current = new Set((project.members ?? []).map((m) => m.gid))
const toAdd = (like.members ?? []).filter((m) => !current.has(m.gid))
if (toAdd.length) {
  await asana(`/projects/${project.gid}/addMembers`, { method: 'POST', body: { data: { members: toAdd.map((m) => m.gid).join(',') } } })
  summary.push(`Leden toegevoegd: ${toAdd.length}`)
}
if (assigneeName && ![...(like.members ?? []), ...(project.members ?? [])].some((m) => norm(m.name).includes(norm(assigneeName)))) {
  warnings.push(`Geen lid gevonden met "${assigneeName}"; de assignee moet lid zijn van het project.`)
}

// 4. Secties
const sections = await asana(`/projects/${project.gid}/sections?opt_fields=name`)
const have = (name) => sections.find((s) => norm(s.name) === norm(name))
if (sections.length === 1 && !SECTIONS.some((n) => have(n))) {
  // Het lege standaardsectie van een nieuw project hernoemen, zodat nieuwe taken daar landen.
  await asana(`/sections/${sections[0].gid}`, { method: 'PUT', body: { data: { name: SECTIONS[0] } } })
  sections[0].name = SECTIONS[0]
}
for (const name of SECTIONS) {
  if (have(name)) continue
  const s = await asana(`/projects/${project.gid}/sections`, { method: 'POST', body: { data: { name } } })
  sections.push(s)
}
// Volgorde van het bord gelijk aan SECTIONS (nieuwe secties komen achteraan te staan).
const wanted = SECTIONS.map((n) => have(n))
const actual = sections.filter((s) => wanted.includes(s))
if (actual.some((s, i) => s !== wanted[i])) {
  for (let i = 1; i < wanted.length; i++) {
    await asana(`/projects/${project.gid}/sections/insert`, { method: 'POST', body: { data: { section: wanted[i].gid, after_section: wanted[i - 1].gid } } })
  }
  summary.push(`Secties herschikt: ${SECTIONS.join(' → ')}`)
} else {
  summary.push(`Secties: ${SECTIONS.join(' → ')}`)
}

// 5. Custom fields (Asana Starter of hoger)
const settings = await asana(
  `/projects/${project.gid}/custom_field_settings?limit=100&opt_fields=custom_field.gid,custom_field.name,custom_field.resource_subtype,custom_field.enum_options.gid,custom_field.enum_options.name,custom_field.enum_options.enabled`,
)
const onProject = settings.map((s) => s.custom_field)
let library = null
try {
  library = await asana(`/workspaces/${workspaceGid}/custom_fields?limit=100&opt_fields=name,resource_subtype,enum_options.gid,enum_options.name,enum_options.enabled`)
} catch (e) {
  warnings.push(`Kon de veldenbibliotheek niet lezen (${e.message}); velden worden zo nodig nieuw aangemaakt.`)
}

// Sommige velden horen ook in het planningsproject ("4. Werkplanning"): alleen velden die daar aan
// het project hangen kun je in de kalender als kleur gebruiken.
const planningGid = args.planning && args.planning !== 'true' ? extractGid(args.planning) : null
let planningVelden = null
async function koppelAanPlanning(field) {
  if (!planningGid) return
  try {
    if (!planningVelden) {
      const s = await asana(`/projects/${planningGid}/custom_field_settings?limit=100&opt_fields=custom_field.gid`)
      planningVelden = new Set(s.map((x) => x.custom_field?.gid).filter(Boolean))
    }
    if (planningVelden.has(field.gid)) return
    await asana(`/projects/${planningGid}/addCustomFieldSetting`, { method: 'POST', body: { data: { custom_field: field.gid, is_important: false } } })
    planningVelden.add(field.gid)
    summary.push(`Veld "${field.name}" ook aan het planningsproject gekoppeld (voor de kleur in de kalender)`)
  } catch (e) {
    warnings.push(`Veld "${field.name}" kon niet aan het planningsproject gekoppeld worden: ${e.message}`)
  }
}

let premiumBlocked = false
for (const spec of FIELD_SPECS) {
  if (premiumBlocked) break
  const name = map[spec.key]
  if (!name) {
    warnings.push(`Geen veldnaam voor "${spec.key}" in asana-field-map.json.`)
    continue
  }
  const optionLabel = (ourKey) => map.option_aliases?.[ourKey]?.[0] ?? ourKey
  try {
    let field = onProject.find((f) => norm(f.name) === norm(name)) ?? library?.find((f) => norm(f.name) === norm(name)) ?? null
    let status = 'bestond al'
    if (field && field.resource_subtype !== spec.type) {
      if (spec.vervangBijAnderType) {
        // Asana kan het type van een bestaand veld niet wijzigen, dus het oude veld gaat weg en er
        // komt een nieuw veld met dezelfde naam voor in de plaats.
        await asana(`/custom_fields/${field.gid}`, { method: 'DELETE' })
        const weg = onProject.findIndex((f) => f.gid === field.gid)
        if (weg >= 0) onProject.splice(weg, 1)
        summary.push(`Veld "${name}" bestond als ${field.resource_subtype} en is verwijderd om het als ${spec.type} opnieuw aan te maken`)
        field = null
        status = 'vervangen'
      } else {
        warnings.push(`Veld "${name}" bestaat al als ${field.resource_subtype}, verwacht ${spec.type}; de function past zich aan, maar check het veld.`)
      }
    }
    if (!field) {
      const data = { workspace: workspaceGid, name, resource_subtype: spec.type, description: spec.description }
      if (spec.options) data.enum_options = spec.options.map(([key, color]) => ({ name: optionLabel(key), color, enabled: true }))
      // Een enum-veld moet bij het aanmaken minstens één optie hebben; die van de aanvragers vult
      // de function later aan met de echte namen.
      if (spec.optiesViaFunction) data.enum_options = [{ name: 'Onbekend', color: 'none', enabled: true }]
      field = await asana('/custom_fields', { method: 'POST', body: { data } })
      if (status !== 'vervangen') status = 'aangemaakt'
    } else if (spec.options) {
      // Ontbrekende opties aanvullen op een bestaand enum-veld.
      const enabled = (field.enum_options ?? []).filter((o) => o.enabled !== false)
      for (const [key, color] of spec.options) {
        const aliases = map.option_aliases?.[key] ?? [key]
        if (enabled.some((o) => aliases.some((a) => norm(a) === norm(o.name)))) continue
        await asana(`/custom_fields/${field.gid}/enum_options`, { method: 'POST', body: { data: { name: optionLabel(key), color, enabled: true } } })
        status = 'opties aangevuld'
      }
    }
    if (!onProject.some((f) => f.gid === field.gid)) {
      await asana(`/projects/${project.gid}/addCustomFieldSetting`, { method: 'POST', body: { data: { custom_field: field.gid, is_important: true } } })
      onProject.push(field)
      if (status === 'bestond al') status = 'aan project gekoppeld'
    }
    if (spec.ookInPlanning) await koppelAanPlanning({ gid: field.gid, name })
    summary.push(`Veld "${name}" (${spec.type}): ${status}`)
  } catch (e) {
    if (e.status === 402 || /premium|paid|upgrade|starter/i.test(e.message)) {
      premiumBlocked = true
      warnings.push(
        `Custom fields zijn niet beschikbaar in dit Asana-abonnement (${e.message}). Het project werkt zonder velden: alle gegevens staan in de beschrijving en de deadline als due date.`,
      )
    } else {
      warnings.push(`Veld "${name}": ${e.message}`)
    }
  }
}

// 6. Samenvatting
console.log(`Project: ${project.permalink_url}`)
for (const line of summary) console.log(line)
for (const w of warnings) console.warn(`Let op: ${w}`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `project_gid=${project.gid}\nproject_url=${project.permalink_url}\n`)
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Asana-project\n\n[${project.name}](${project.permalink_url})\n\n${summary.map((s) => `- ${s}`).join('\n')}\n` +
      (warnings.length ? `\n**Let op**\n\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''),
  )
}

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

function extractGid(s) {
  const str = String(s).trim()
  const nieuw = str.match(/\/project\/(\d{6,})/)
  if (nieuw) return nieuw[1]
  const oud = str.match(/\/0\/(\d{6,})/)
  if (oud) return oud[1]
  const m = str.match(/(\d{6,})/)
  return m ? m[1] : null
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
