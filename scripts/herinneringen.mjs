#!/usr/bin/env node
/**
 * De herinnering om akkoord te geven: elke werkdag om 9:00 via .github/workflows/herinneringen.yml.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... MS_TENANT_ID=... MS_CLIENT_ID=... MS_CLIENT_SECRET=... \
 *     node --experimental-strip-types scripts/herinneringen.mjs
 *
 * Opties:
 *   --proef            Niets versturen en niets bijwerken; de mails komen als HTML in
 *                      herinneringen-proef/ (en in de samenvatting van de workflow).
 *   --aan <adres>      Alles naar dit adres in plaats van naar de collega's. Om te testen. Telt
 *                      niet als herinnering: er wordt niets bijgewerkt.
 *   --datum <JJJJ-MM-DD>  Doen alsof het die dag is.
 *
 * Wie krijgt er een? Per aanvraag de laatst verstuurde oplevering, als daar nog geen akkoord of
 * feedback op is, de herinneringen niet gestopt zijn (Afgerond in Asana, of een nieuwere versie) en
 * hij niet vandaag pas verstuurd is. Naar iedereen die de opleveringsmail kreeg (die adressen staan
 * in opleveringen.ontvangers, ook die uit "Ook mailen naar"), plus de aanvrager als die inmiddels
 * een adres heeft in de tabel collegas. De regels staan in shared/akkoord.ts.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { herinneringVandaag, isWerkdag, renderHerinneringMail, waaroverTekst } from '../shared/akkoord.ts'
import { MELDING_AFZENDER, MELDING_ONTVANGERS } from '../shared/contact.ts'
import { createGraphMail } from '../shared/mail.ts'
import { vandaagInNl } from '../shared/spoed.ts'

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
const zeg = (s) => {
  console.log(s)
  regels.push(s)
}
function fail(msg) {
  console.error(`Fout: ${msg}`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `❌ ${msg}\n`)
  process.exit(1)
}
function samenvatting() {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${regels.join('\n')}\n`)
}

const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const sleutel = process.env.SUPABASE_SECRET_KEY ?? process.env.SB_SECRET_KEY ?? ''
if (!base || !sleutel) fail('SUPABASE_URL en SUPABASE_SECRET_KEY zijn verplicht.')

const ms = { tenantId: process.env.MS_TENANT_ID, clientId: process.env.MS_CLIENT_ID, clientSecret: process.env.MS_CLIENT_SECRET }
if (!proef && (!ms.tenantId || !ms.clientId || !ms.clientSecret)) {
  fail('MS_TENANT_ID, MS_CLIENT_ID en MS_CLIENT_SECRET zijn nodig om te mailen. Zonder die drie kan alleen --proef.')
}

zeg(`### Herinneringen ${vandaag}`)
zeg('')
if (!isWerkdag(vandaag)) {
  zeg('Geen werkdag; er gaan vandaag geen herinneringen uit.')
  samenvatting()
  process.exit(0)
}

const kop = { apikey: sleutel, Authorization: `Bearer ${sleutel}`, 'Content-Type': 'application/json' }
async function rest(pad, init = {}) {
  const res = await fetch(`${base}/rest/v1/${pad}`, { ...init, headers: { ...kop, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) })
  const tekst = await res.text()
  if (!res.ok) throw new Error(`REST ${pad.split('?')[0]} → ${res.status}: ${tekst.slice(0, 300)}`)
  return tekst ? JSON.parse(tekst) : null
}

let open
try {
  open = await rest('opleveringen?select=id,aanvraag_id,versie,ontvangers,verstuurd_op,herinneren,akkoord_op,feedback_op,gestopt_op,herinneringen,laatste_herinnering'
    + '&status=eq.verstuurd&herinneren=is.true&akkoord_op=is.null&feedback_op=is.null&gestopt_op=is.null&order=verstuurd_op.desc')
} catch (e) {
  fail(e.message)
}

// Per aanvraag alleen de nieuwste: een akkoord gaat altijd over de laatste versie.
const perAanvraag = new Map()
for (const o of open) if (!perAanvraag.has(o.aanvraag_id)) perAanvraag.set(o.aanvraag_id, o)
const vandaagAan = [...perAanvraag.values()].filter((o) => herinneringVandaag(o, vandaag))
zeg(`${perAanvraag.size} oplevering(en) wachten op akkoord; ${vandaagAan.length} krijgen vandaag een herinnering.`)
if (!vandaagAan.length) {
  samenvatting()
  process.exit(0)
}

const ids = vandaagAan.map((o) => o.aanvraag_id)
const aanvragen = new Map((await rest(`aanvragen?select=id,naam,locatie,soort,event,event_datum,omschrijving,aanvraag_types,anders_tekst,vervallen_op`
  + `&id=in.(${ids.join(',')})`)).map((a) => [a.id, a]))
const adressen = new Map()
for (const c of await rest('collegas?select=naam,email&email=not.is.null')) {
  const k = String(c.naam ?? '').trim().toLowerCase()
  if (k && c.email?.trim() && !adressen.has(k)) adressen.set(k, c.email.trim())
}

const mail = proef ? null : createGraphMail({ ...ms, afzender: process.env.MAIL_AFZENDER || MELDING_AFZENDER })
if (proef) mkdirSync('herinneringen-proef', { recursive: true })

let verstuurd = 0
let mislukt = 0
for (const o of vandaagAan) {
  const a = aanvragen.get(o.aanvraag_id)
  if (!a || a.vervallen_op) continue
  const waarover = {
    soort: a.soort, event: a.event ?? '', eventDatum: a.event_datum, omschrijving: a.omschrijving ?? '',
    types: a.aanvraag_types ?? [], andersTekst: a.anders_tekst ?? '',
  }
  // Wie de opleveringsmail kreeg, en de aanvrager. Zonder dubbelen, hoofdletters daargelaten.
  const namen = [a.naam]
  const gezien = new Set()
  const echt = [...(o.ontvangers ?? []), ...namen.map((n) => adressen.get(String(n).trim().toLowerCase()))]
    .filter(Boolean)
    .filter((adres) => {
      const k = adres.trim().toLowerCase()
      if (gezien.has(k)) return false
      gezien.add(k)
      return true
    })
  if (!echt.length) {
    zeg(`- ${waaroverTekst(waarover)}: niemand met een mailadres (${namen.join(', ')}); overgeslagen.`)
    continue
  }
  const nummer = (o.herinneringen ?? 0) + 1
  const bericht = renderHerinneringMail({
    ...waarover,
    aan: testAdres ? [testAdres] : echt,
    antwoordAan: [MELDING_ONTVANGERS[a.locatie] ?? MELDING_ONTVANGERS.nbc],
    aanvraagId: a.id,
    locatie: a.locatie,
    versie: o.versie,
    verstuurdOp: o.verstuurd_op,
    nummer,
    aanvrager: a.naam,
  })
  if (proef) {
    writeFileSync(`herinneringen-proef/${a.id}.html`, bericht.html)
    zeg(`- (proef) ${bericht.onderwerp} → ${echt.join(', ')}`)
    continue
  }
  try {
    await mail.verstuur(bericht)
    verstuurd++
    zeg(`- ${bericht.onderwerp} → ${testAdres ?? echt.join(', ')}${testAdres ? ' (testadres)' : ` (herinnering ${nummer})`}`)
    // Een testrun telt niet: anders slaat de echte run van morgen er een over.
    if (!testAdres) {
      await rest(`opleveringen?id=eq.${o.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ herinneringen: nummer, laatste_herinnering: new Date().toISOString() }),
      })
    }
  } catch (e) {
    mislukt++
    zeg(`- ❌ ${waaroverTekst(waarover)}: ${e.message}`)
  }
}

zeg('')
zeg(proef ? 'Proef: niets verstuurd en niets bijgewerkt.' : `${verstuurd} herinnering(en) verstuurd${mislukt ? `, ${mislukt} mislukt` : ''}.`)
samenvatting()
if (mislukt) process.exit(1)
