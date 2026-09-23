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
import { menuIsBruikbaar, renderMenuComment, renderMenuFailureComment } from './lib/notes.mjs'
import { leesMenuTekst, kiesPakket } from './menu/menu-tekst.mjs'
import { renderMenu, pakketten, pakketkenmerken } from './menu/render.mjs'

const args = parseArgs()
const dryRun = Boolean(args['dry-run'])
const id = args['aanvraag-id'] ?? null

if (id && !UUID_RE.test(id)) {
  console.error('Ongeldig aanvraag-id (geen UUID).')
  process.exit(2)
}
if (!id && !args.data && !args.tekst) {
  console.error('Geef --aanvraag-id <uuid>, of --data/--tekst <bestand> met --dry-run.')
  process.exit(2)
}

/** Een bestandsnaam die het in Asana en in Storage doet. */
function veiligeNaam(deel) {
  return String(deel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

let aanvraag = null
let inhoud = args.data ? JSON.parse(readFileSync(args.data, 'utf8')) : null
let ruweTekst = args.tekst ? readFileSync(args.tekst, 'utf8') : null
const invoerNotities = []

if (id) {
  const { getAanvraag } = await import('./lib/supabase.mjs')
  aanvraag = await getAanvraag(id)
  // --data wint van wat er in de database staat; zo kun je een scherm opnieuw
  // draaien met aangepaste inhoud zonder eerst de aanvraag bij te werken.
  inhoud = inhoud ?? aanvraag.menu_inhoud ?? null
  ruweTekst = ruweTekst ?? aanvraag.menu_tekst ?? null
}

/**
 * De collega plakt de menu-invulling als tekst in het formulier. Die lezen we
 * hier uit en leggen we naast de basisontwerpen om te bepalen welk pakket het is.
 * Staat er al een uitgewerkte menu_inhoud, dan gaat die voor: dat is een bewuste
 * correctie met de hand.
 */
if (!inhoud && ruweTekst && ruweTekst.trim()) {
  const { secties, opmerkingen } = leesMenuTekst(ruweTekst)
  if (!secties.length) {
    await afbreken('De menu-invulling is niet te lezen: er staan geen gerechten in. '
      + 'Verwacht wordt een kopje per gang en daaronder de gerechten met een bolletje ervoor.')
  }
  const keuze = kiesPakket(secties, pakketkenmerken())
  invoerNotities.push(...opmerkingen)
  invoerNotities.push(keuze.uitleg)
  if (!keuze.pakket) {
    await afbreken(`${keuze.uitleg} Zet het juiste pakket erbij, of pas de kopjes aan. `
      + `Beschikbaar: ${pakketten().join(', ')}.`)
  }
  inhoud = { pakket: keuze.pakket, secties }
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
  await afbreken('Er staat geen menu-invulling bij deze aanvraag.')
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

// Tekst die over een blob, de logobalk of de dieetwens-regel loopt maakt het scherm
// onbruikbaar. Zo'n scherm gaat niet als resultaat de deur uit: het komt wel mee als
// bijlage - je moet kunnen zien waar het misgaat - maar onder een naam die geen
// misverstand toelaat, met de status op failed.
const bruikbaar = menuIsBruikbaar(meldingen)
const bestandsnaam = bruikbaar
  ? `menuscherm-${veiligeNaam(inhoud.pakket)}.png`
  : `NIET-BRUIKBAAR-menuscherm-${veiligeNaam(inhoud.pakket)}.png`
const aantalMeldingen = ['botsingen', 'overloop', 'structuur', 'regelval', 'opmaak']
  .reduce((n, k) => n + (meldingen[k]?.length ?? 0), 0)

if (dryRun || !id) {
  const uit = args.out ?? join(outDirFor(inhoud.pakket), bestandsnaam)
  writeFileSync(uit, png)
  for (const n of invoerNotities) log(`invulling: ${n}`)
  for (const soort of ['botsingen', 'overloop', 'structuur', 'opmaak', 'regelval']) {
    for (const m of meldingen[soort] ?? []) {
      log(`${soort}: ${typeof m === 'string' ? m : JSON.stringify(m)}`)
    }
  }
  console.log(`Dry-run: geen Asana of Supabase. Scherm staat in ${uit} (${aantalMeldingen} melding(en)).`)
  if (!bruikbaar) {
    console.error('Dit scherm is NIET bruikbaar: de tekst loopt over vaste onderdelen van het ontwerp.')
    process.exit(1)
  }
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
  invoer: invoerNotities,
  sessionUrl: aanvraag.brand_session_url ?? null,
}))
log('Asana-comment geplaatst', { meldingen: aantalMeldingen })

const blokkades = meldingen.botsingen.map((b) => `"${b.tekst}" loopt over ${b.waar ?? 'een vast onderdeel'}`)
  .concat(meldingen.overloop ?? [])

await updateMenu(id, {
  menu_status: bruikbaar ? 'done' : 'failed',
  menu_error: bruikbaar ? null
    : `Het scherm is niet bruikbaar: ${blokkades.join('; ')}`.slice(0, 500),
  menu_result: {
    pakket: inhoud.pakket,
    invoer: invoerNotities,
    bruikbaar,
    bestandsnaam,
    asana_gid: bijlage.gid,
    storage_path: opslagpad,
    bytes: png.length,
    meldingen,
  },
})

log('klaar', { id, taskGid, pakket: inhoud.pakket, meldingen: aantalMeldingen, bruikbaar })
if (!bruikbaar) {
  console.error(`Menuscherm ${inhoud.pakket} is NIET bruikbaar en staat als zodanig bij `
    + `Asana-taak ${taskGid} (${aanvraag.asana_task_url ?? ''}): ${blokkades.join('; ')}`)
  process.exit(1)
}
console.log(`Menuscherm ${inhoud.pakket} staat bij Asana-taak ${taskGid} `
  + `(${aanvraag.asana_task_url ?? ''}) met ${aantalMeldingen} melding(en).`)
