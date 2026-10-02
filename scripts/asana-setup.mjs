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
import { zorgVoorVelden } from './asana-velden.mjs'

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

// 5. Custom fields (Asana Starter of hoger). Welke velden dat zijn en wat ze moeten
// kunnen staat in scripts/asana-velden.mjs, zodat de velden-workflow precies hetzelfde
// kan aanmaken als deze.
const planningGid = args.planning && args.planning !== 'true' ? extractGid(args.planning) : null
const velden = await zorgVoorVelden({ asana, map, workspaceGid, projectGid: project.gid, planningGid })
summary.push(...velden.summary)
warnings.push(...velden.warnings)

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
