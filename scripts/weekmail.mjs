#!/usr/bin/env node
/**
 * Het weekoverzicht op maandagochtend: de deadlines van deze week en waar Marketing op moet letten,
 * per locatie naar het eigen marketingpostvak. Draait via .github/workflows/weekmail.yml.
 *
 *   ASANA_PAT=... MS_TENANT_ID=... MS_CLIENT_ID=... MS_CLIENT_SECRET=... \
 *     node --experimental-strip-types scripts/weekmail.mjs
 *
 * Opties:
 *   --proef            Niets versturen; de mails komen als HTML in weekmail-proef/ (en in de
 *                      samenvatting van de workflow). Microsoft hoeft dan niet ingesteld te zijn.
 *   --aan <adres>      Alles naar dit adres in plaats van naar de marketingpostvakken. Om te testen.
 *   --datum <JJJJ-MM-DD>  Doen alsof het die dag is.
 *
 * Wat erin staat bepaalt shared/weekmail.ts; dit script haalt alleen op en verstuurt.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import fields from '../shared/asana-fields.json' with { type: 'json' }
import { MELDING_AFZENDER } from '../shared/contact.ts'
import { createGraphMail } from '../shared/mail.ts'
import { LOCATIE_KEYS } from '../shared/request-types.ts'
import { vandaagInNl } from '../shared/spoed.ts'
import { maakWeekoverzicht, renderWeekmail, taakUitAsana } from '../shared/weekmail.ts'

const API = process.env.ASANA_API ?? 'https://app.asana.com/api/1.0'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)
const proef = args.proef === 'true'
const testAdres = args.aan && args.aan !== 'true' ? String(args.aan).trim() : null
const vandaag = /^\d{4}-\d{2}-\d{2}$/.test(String(args.datum ?? '')) ? String(args.datum) : vandaagInNl()

const regels = []
function fail(msg) {
  console.error(`Fout: ${msg}`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `❌ ${msg}\n`)
  process.exit(1)
}

const pat = process.env.ASANA_PAT
if (!pat) fail('ASANA_PAT ontbreekt.')
const projectGid = process.env.ASANA_PROJECT_GID || fields.project?.gid
if (!projectGid) fail('Geen Asana-project; draai eerst "Asana-velden vernieuwen".')

const ms = { tenantId: process.env.MS_TENANT_ID, clientId: process.env.MS_CLIENT_ID, clientSecret: process.env.MS_CLIENT_SECRET }
if (!proef && (!ms.tenantId || !ms.clientId || !ms.clientSecret)) {
  fail('MS_TENANT_ID, MS_CLIENT_ID en MS_CLIENT_SECRET zijn nodig om te mailen. Zonder die drie kan alleen --proef.')
}

/** Alle open taken van het project; Asana geeft ze per honderd. */
async function openTaken() {
  const optFields = [
    'name', 'permalink_url', 'due_on',
    'memberships.project.gid', 'memberships.section.gid', 'memberships.section.name',
    'custom_fields.gid', 'custom_fields.date_value.date', 'custom_fields.enum_value.name',
  ].join(',')
  const taken = []
  let offset = null
  do {
    const q = new URLSearchParams({ completed_since: 'now', opt_fields: optFields, limit: '100' })
    if (offset) q.set('offset', offset)
    const res = await fetch(`${API}/projects/${projectGid}/tasks?${q}`, {
      headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) fail(`Asana gaf ${res.status}: ${(body.errors ?? []).map((e) => e.message).join('; ')}`)
    taken.push(...(body.data ?? []))
    offset = body.next_page?.offset ?? null
  } while (offset)
  return taken
}

const taken = (await openTaken()).map((t) => taakUitAsana(t, fields))
regels.push(`### Weekoverzicht ${vandaag}`, '', `${taken.length} open taken in Asana.`, '')

const mail = proef ? null : createGraphMail({ ...ms, afzender: process.env.MAIL_AFZENDER || MELDING_AFZENDER })
if (proef) mkdirSync('weekmail-proef', { recursive: true })

let mislukt = 0
for (const locatie of LOCATIE_KEYS) {
  const overzicht = maakWeekoverzicht(taken.filter((t) => t.locatie === locatie), vandaag)
  const bericht = renderWeekmail(overzicht, locatie, fields.project?.url ?? null)
  const aan = testAdres ? [testAdres] : bericht.aan
  const regel = `**${bericht.onderwerp}** → ${aan.join(', ')}`
  if (proef) {
    writeFileSync(`weekmail-proef/${locatie}.html`, bericht.html)
    regels.push(`- (proef, niet verstuurd) ${regel}`)
    continue
  }
  try {
    await mail.verstuur({ ...bericht, aan })
    regels.push(`- ✅ ${regel}`)
  } catch (e) {
    mislukt++
    regels.push(`- ❌ ${regel}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

console.log(regels.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${regels.join('\n')}\n`)
if (mislukt) process.exit(1)
