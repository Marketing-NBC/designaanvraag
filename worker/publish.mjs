#!/usr/bin/env node
/**
 * Stap 4: huisstijl-kaart renderen, bijlagen en sectie naar Asana, resultaat naar Supabase.
 *   node worker/publish.mjs --aanvraag-id <uuid>
 *   node worker/publish.mjs --dir worker/out/<map> --dry-run     (alleen de kaart renderen, geen Asana/Supabase)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brandBriefSchema } from '../shared/brand-brief-schema.ts'
import { addComment, getTask, updateTaskHtmlNotes, uploadAttachment } from './lib/asana.mjs'
import { log, outDirFor, parseArgs, UUID_RE } from './lib/config.mjs'
import { renderKaart } from './lib/kaart.mjs'
import { hostOf, mergeIntoNotes, renderComment, renderHuisstijlSection } from './lib/notes.mjs'

const args = parseArgs()
const dryRun = Boolean(args['dry-run'])
const id = args['aanvraag-id'] ?? null
if (id && !UUID_RE.test(id)) {
  console.error('Ongeldig aanvraag-id (geen UUID).')
  process.exit(2)
}
const dir = args.dir ?? (id ? outDirFor(id) : null)
if (!dir) {
  console.error('Geef --aanvraag-id <uuid> of --dir <map>.')
  process.exit(2)
}

const brief = brandBriefSchema.parse(JSON.parse(readFileSync(join(dir, 'brand-brief.json'), 'utf8')))
const signals = JSON.parse(readFileSync(join(dir, 'signals.json'), 'utf8'))
const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {}
const website = signals.url

// Logo kiezen: origineel (svg/png) voor het marketingteam; voor de kaart de view-versie als het origineel geen svg/png is.
const cand = brief.logo.candidate_index === null ? null : signals.logos.find((l) => l.index === brief.logo.candidate_index)
const logoOriginal = cand?.files?.original ?? cand?.files?.shot ?? null
const logoForKaart = cand ? (/\.(svg|png)$/i.test(cand.files?.original ?? '') ? cand.files.original : cand.files?.shot ?? cand.files?.view ?? null) : null

log('kaart renderen')
const kaartPng = await renderKaart({ brief, signals, outDir: dir, logoFile: logoForKaart })
writeFileSync(join(dir, 'huisstijl-kaart.png'), kaartPng)
log('kaart klaar', { file: join(dir, 'huisstijl-kaart.png') })

if (dryRun) {
  console.log('Dry-run: geen Asana of Supabase. Kaart staat in', join(dir, 'huisstijl-kaart.png'))
  process.exit(0)
}
if (!id) {
  console.error('Zonder --aanvraag-id kan alleen --dry-run.')
  process.exit(2)
}

const { getAanvraag, updateAanvraag, uploadAsset } = await import('./lib/supabase.mjs')
const aanvraag = await getAanvraag(id)
const taskGid = aanvraag.asana_task_gid ?? meta.asana_task_gid
if (!taskGid) throw new Error('Aanvraag heeft geen asana_task_gid; niets om bij te werken.')

const slug = hostOf(website).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'merk'
const attachmentNames = {}
const assets = []

async function attach(localFile, remoteName, contentType) {
  const buf = readFileSync(join(dir, localFile))
  const att = await uploadAttachment(taskGid, remoteName, buf, contentType)
  const storagePath = await uploadAsset(id, remoteName, buf, contentType)
  assets.push({ name: remoteName, asana_gid: att.gid, storage_path: storagePath, bytes: buf.length })
  log('bijlage geüpload', { remoteName, gid: att.gid })
  return att
}

if (logoOriginal) {
  const ext = logoOriginal.split('.').pop().toLowerCase()
  const type = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'application/octet-stream'
  attachmentNames.logo = `logo-${slug}.${ext}`
  await attach(logoOriginal, attachmentNames.logo, type)
}
attachmentNames.kaart = `huisstijl-kaart-${slug}.png`
const kaartAtt = await attach('huisstijl-kaart.png', attachmentNames.kaart, 'image/png')
if (signals.screenshots?.hero && existsSync(join(dir, signals.screenshots.hero))) {
  attachmentNames.screenshot = `screenshot-${slug}.png`
  await attach(signals.screenshots.hero, attachmentNames.screenshot, 'image/png')
}

// Beschrijving aanvullen (markerregel vervangen); lukt dat niet, dan alles in de comment.
const section = renderHuisstijlSection({ brief, website, attachmentNames, kaartGid: kaartAtt.gid, sessionUrl: aanvraag.brand_session_url })
let notesUpdated = false
try {
  const task = await getTask(taskGid)
  const merged = mergeIntoNotes(task.html_notes, section)
  if (merged) {
    await updateTaskHtmlNotes(taskGid, merged)
    notesUpdated = true
    log('beschrijving bijgewerkt')
  }
} catch (e) {
  log('beschrijving bijwerken mislukt, valt terug op comment', { error: e.message })
}
if (!notesUpdated) {
  // Comment-variant zonder img/koppen.
  await addComment(taskGid, `<body>${section.replace(/<img[^>]*>\n?/g, '').replace(/<\/?h2>/g, '')}</body>`)
} else {
  const comment = renderComment({ brief, website, attachmentNames })
  if (comment) await addComment(taskGid, comment)
}

writeFileSync(join(dir, 'assets.json'), JSON.stringify(assets, null, 2))
await uploadAsset(id, 'brand-brief.json', Buffer.from(JSON.stringify(brief, null, 2)), 'application/json')
await updateAanvraag(id, {
  brand_status: 'done',
  brand_error: null,
  brand_result: { brief, assets, notes_updated: notesUpdated, extracted_at: signals.extracted_at, fallback: signals.fallback, title: signals.title, final_url: signals.final_url },
})
log('klaar', { id, taskGid, assets: assets.length, notesUpdated })
console.log(`Gepubliceerd naar Asana-taak ${taskGid} (${aanvraag.asana_task_url ?? ''}).`)
