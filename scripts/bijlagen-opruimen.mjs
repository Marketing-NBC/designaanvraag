#!/usr/bin/env node
/**
 * Ruimt meegestuurde bestanden op. Draait elke nacht via .github/workflows/bijlagen-opruimen.yml.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/bijlagen-opruimen.mjs [--dry-run]
 *
 * Drie passes:
 *  1. Verlopen      — hoort bij een aanvraag, ouder dan 30 dagen. Staat allang als bijlage bij de
 *                     taak, dus de kopie mag weg. De rij blijft als spoor.
 *  2. Achtergebleven — wel geüpload, nooit een aanvraag van gekomen, ouder dan 7 dagen.
 *  3. Verzoening    — bestanden in de opslag zonder rij in de tabel. Vangnet.
 *
 * Geen automatische herkansing: binnen het plafond hoort doorzetten gewoon te lukken. Blijft er toch
 * iets liggen, dan komt dat in de samenvatting te staan — dan weten we dát het voorkomt voordat we
 * er iets voor bouwen.
 *
 * Bewust zonder dependencies, net als scripts/asana-webhook.mjs: dan hoeft de workflow geen
 * npm-installatie te doen.
 */

import { appendFileSync } from 'node:fs'

const BUCKET = 'aanvraag-bijlagen'
const BEWAARDAGEN = 30
const ACHTERGEBLEVEN_DAGEN = 7

const droog = process.argv.includes('--dry-run')
const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const sleutel = process.env.SUPABASE_SECRET_KEY ?? process.env.SB_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!base || !sleutel) {
  console.error('SUPABASE_URL en SUPABASE_SECRET_KEY zijn verplicht.')
  process.exit(1)
}

const regels = []
const zeg = (s) => {
  console.log(s)
  regels.push(s)
}

const kop = { apikey: sleutel, Authorization: `Bearer ${sleutel}`, 'Content-Type': 'application/json' }

async function rest(pad, init = {}) {
  const res = await fetch(`${base}/rest/v1/${pad}`, { ...init, headers: { ...kop, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) })
  const tekst = await res.text()
  if (!res.ok) throw new Error(`REST ${pad} → ${res.status}: ${tekst.slice(0, 300)}`)
  return tekst ? JSON.parse(tekst) : null
}

/** Storage weigert meer dan een paar honderd paden per verzoek, dus in stukjes. */
async function verwijderUitOpslag(paden) {
  for (let i = 0; i < paden.length; i += 100) {
    const deel = paden.slice(i, i + 100)
    const res = await fetch(`${base}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: kop,
      body: JSON.stringify({ prefixes: deel }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Storage delete → ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

const dagenGeleden = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

async function ruimOp(naam, filter) {
  const rijen = await rest(`bijlagen?select=id,storage_path,bestandsnaam&${filter}&limit=500`)
  if (!rijen.length) {
    zeg(`- ${naam}: niets te doen`)
    return
  }
  if (droog) {
    zeg(`- ${naam}: ${rijen.length} zou(den) verdwijnen (proefdraai)`)
    return
  }
  await verwijderUitOpslag(rijen.map((r) => r.storage_path))
  await rest(`bijlagen?id=in.(${rijen.map((r) => r.id).join(',')})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'opgeruimd', opgeruimd_op: new Date().toISOString() }),
  })
  zeg(`- ${naam}: ${rijen.length} opgeruimd`)
}

zeg(`### Bijlagen opruimen${droog ? ' (proefdraai)' : ''}`)
zeg('')

// 1. Verlopen: hoort bij een aanvraag of aanvulling en is oud genoeg.
await ruimOp(
  `Verlopen (ouder dan ${BEWAARDAGEN} dagen)`,
  `status=neq.opgeruimd&created_at=lt.${dagenGeleden(BEWAARDAGEN)}&or=(aanvraag_id.not.is.null,aanvulling_id.not.is.null)`,
)

// 2. Achtergebleven: geüpload, maar het formulier is nooit afgemaakt.
await ruimOp(
  `Achtergebleven (ouder dan ${ACHTERGEBLEVEN_DAGEN} dagen)`,
  `status=eq.verwacht&created_at=lt.${dagenGeleden(ACHTERGEBLEVEN_DAGEN)}&aanvraag_id=is.null&aanvulling_id=is.null`,
)

// 3. Verzoening: bestanden in de opslag zonder rij. Alleen mappen die ouder zijn dan het
//    achtergebleven-venster, anders ruimen we iemands lopende formulier op.
{
  const res = await fetch(`${base}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: kop,
    body: JSON.stringify({ prefix: '', limit: 1000, sortBy: { column: 'created_at', order: 'asc' } }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    zeg(`- Verzoening: overgeslagen (opslag gaf HTTP ${res.status})`)
  } else {
    const mappen = (await res.json()).filter((o) => o.name && !o.id) // mappen hebben geen id
    const grens = dagenGeleden(ACHTERGEBLEVEN_DAGEN)
    const bekend = new Set((await rest('bijlagen?select=groep_id&status=neq.opgeruimd')).map((r) => r.groep_id))
    const wees = mappen.filter((m) => !bekend.has(m.name) && (m.created_at ?? grens) < grens)
    if (!wees.length) zeg('- Verzoening: niets te doen')
    else if (droog) zeg(`- Verzoening: ${wees.length} map(pen) zonder administratie (proefdraai)`)
    else {
      for (const map of wees) {
        const inhoud = await fetch(`${base}/storage/v1/object/list/${BUCKET}`, {
          method: 'POST',
          headers: kop,
          body: JSON.stringify({ prefix: map.name, limit: 100 }),
          signal: AbortSignal.timeout(30_000),
        }).then((r) => (r.ok ? r.json() : []))
        await verwijderUitOpslag(inhoud.map((o) => `${map.name}/${o.name}`))
      }
      zeg(`- Verzoening: ${wees.length} map(pen) zonder administratie opgeruimd`)
    }
  }
}

// Melden wat blijft liggen: bijlagen die bij een taak horen maar nooit zijn doorgezet.
{
  const blijft = await rest('bijlagen?select=id,bestandsnaam&status=eq.verwacht&or=(aanvraag_id.not.is.null,aanvulling_id.not.is.null)&limit=50')
  if (blijft.length) {
    zeg('')
    zeg(`**Let op:** ${blijft.length} bijlage(n) horen bij een aanvraag maar staan nog niet bij de taak:`)
    for (const b of blijft.slice(0, 10)) zeg(`  - ${b.bestandsnaam} (${b.id})`)
    zeg('Dat hoort niet voor te komen; als het vaker gebeurt is een herkansing alsnog de moeite waard.')
  }
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${regels.join('\n')}\n`)
