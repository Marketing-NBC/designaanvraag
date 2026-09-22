#!/usr/bin/env node
/**
 * Maakt het menuscherm van een aanvraag op en levert het af in Asana.
 *
 *   node worker/menu-publiceer.mjs --aanvraag-id <uuid>
 *   node worker/menu-publiceer.mjs --aanvraag-id <uuid> --data menu.json
 *   node worker/menu-publiceer.mjs --data menu.json --out scherm.png --dry-run
 *
 * De collega die de aanvraag indient ziet hier niets van. Het scherm komt als
 * bijlage bij de Asana-taak en alles wat de opmaak-engine opmerkt komt daar als
 * comment bij te staan: tekst die een blob zou raken, een gerecht dat anders
 * afbreekt dan in het basisontwerp, een opsomming die van vorm wisselt. Marketing
 * werkt in Asana, dus daar hoort het te landen - niet in een logbestand.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { addComment, uploadAttachment } from './lib/asana.mjs'
import { log, outDirFor, parseArgs, UUID_RE } from './lib/config.mjs'
import { renderMenuComment, renderMenuFailureComment } from './lib/notes.mjs'
import { renderMenu, pakketten } from './menu/render.mjs'

const args = parseArgs()
const dryRun = Boolean(args['dry-run'])
const id = args['aanvraag-id'] ?? null

if (id && !UUID_RE.test(id)) {
  console.error('Ongeldig aanvraag-id (geen UUID).')
  process.exit(2)
}
if (!id && !args.data) {
  console.error('Geef --aanvraag-id <uuid>, of --data <bestand> met --dry-run.')
  process.exit(2)
}

/** Een bestandsnaam die het in Asana en in Storage doet. */
function veiligeNaam(deel) {
  return String(deel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

let aanvraag = null
let inhoud = args.data ? JSON.parse(readFileSync(args.data, 'utf8')) : null

if (id) {
  const { getAanvraag } = await import('./lib/supabase.mjs')
  aanvraag = await getAanvraag(id)
  // --data wint van wat er in de database staat; zo kun je een scherm opnieuw
  // draaien met aangepaste inhoud zonder eerst de aanvraag bij te werken.
  inhoud = inhoud ?? aanvraag.menu_inhoud ?? null
}

/** Meldt de fout in Asana en zet de status, zodat een mislukking nooit stil blijft. */
async function afbreken(reden, pakket = null) {
  log('menuscherm mislukt', { reden })
  if (!id || dryRun) {
    console.error(reden)
    process.exit(1)
  }
  const { updateMenu } = await import('./lib/supabase.mjs')
  await updateMenu(id, { menu_status: 'failed', menu_error: String(reden).slice(0, 500) })
  if (aanvraag?.asana_task_gid) {
    try {
      await addComment(aanvraag.asana_task_gid, renderMenuFailureComment({ pakket, reason: reden }))
      log('Asana-comment geplaatst')
    } catch (e) {
      log('Asana-comment mislukt', { error: e.message })
    }
  }
  console.error(reden)
  process.exit(1)
}

if (!inhoud) {
  await afbreken('Er staat geen menu-inhoud bij deze aanvraag (menu_inhoud is leeg).')
}
if (!inhoud.pakket) {
  await afbreken('De menu-inhoud noemt geen pakket. '
    + `Beschikbaar: ${pakketten().join(', ')}.`)
}
if (!pakketten().includes(inhoud.pakket)) {
  await afbreken(`Onbekend pakket "${inhoud.pakket}". `
    + `Beschikbaar: ${pakketten().join(', ')}.`, inhoud.pakket)
}

if (id && !dryRun) {
  const { updateMenu } = await import('./lib/supabase.mjs')
  await updateMenu(id, { menu_status: 'running', menu_error: null })
}

log('menuscherm renderen', { pakket: inhoud.pakket })
let png
let meldingen
try {
  ({ png, meldingen } = await renderMenu(inhoud))
} catch (e) {
  await afbreken(`De opmaak liep vast: ${e.message}`, inhoud.pakket)
}

const bestandsnaam = `menuscherm-${veiligeNaam(inhoud.pakket)}.png`
const aantalMeldingen = ['botsingen', 'overloop', 'structuur', 'regelval', 'opmaak']
  .reduce((n, k) => n + (meldingen[k]?.length ?? 0), 0)

if (dryRun || !id) {
  const uit = args.out ?? join(outDirFor(inhoud.pakket), bestandsnaam)
  writeFileSync(uit, png)
  for (const soort of ['botsingen', 'overloop', 'structuur', 'opmaak', 'regelval']) {
    for (const m of meldingen[soort] ?? []) {
      log(`${soort}: ${typeof m === 'string' ? m : JSON.stringify(m)}`)
    }
  }
  console.log(`Dry-run: geen Asana of Supabase. Scherm staat in ${uit} (${aantalMeldingen} melding(en)).`)
  process.exit(0)
}

const taskGid = aanvraag.asana_task_gid
if (!taskGid) {
  await afbreken('Deze aanvraag heeft geen Asana-taak; er is niets om het scherm aan te hangen.',
    inhoud.pakket)
}

const { updateMenu, uploadMenuscherm } = await import('./lib/supabase.mjs')

const bijlage = await uploadAttachment(taskGid, bestandsnaam, png, 'image/png')
log('bijlage geüpload', { bestandsnaam, gid: bijlage.gid })
const opslagpad = await uploadMenuscherm(id, bestandsnaam, png, 'image/png')

await addComment(taskGid, renderMenuComment({
  pakket: inhoud.pakket,
  bestandsnaam,
  meldingen,
  sessionUrl: aanvraag.brand_session_url ?? null,
}))
log('Asana-comment geplaatst', { meldingen: aantalMeldingen })

await updateMenu(id, {
  menu_status: 'done',
  menu_error: null,
  menu_result: {
    pakket: inhoud.pakket,
    bestandsnaam,
    asana_gid: bijlage.gid,
    storage_path: opslagpad,
    bytes: png.length,
    meldingen,
  },
})

log('klaar', { id, taskGid, pakket: inhoud.pakket, meldingen: aantalMeldingen })
console.log(`Menuscherm ${inhoud.pakket} staat bij Asana-taak ${taskGid} `
  + `(${aanvraag.asana_task_url ?? ''}) met ${aantalMeldingen} melding(en).`)
