#!/usr/bin/env node
/**
 * Controleert vóór het echte werk of de omgeving klopt: Supabase bereikbaar, Asana-token geldig.
 *
 *   node worker/check.mjs
 *
 * Zonder deze check merkt de Routine pas ná een paar minuten extractie dat hij niets kan publiceren —
 * en bij een ongeldige ASANA_PAT kan hij het dan niet eens melden, want ook de foutmelding gaat via
 * Asana. Exitcode 0 = alles goed, 2 = Supabase kapot, 3 = alleen Asana kapot.
 */
import { env, log } from './lib/config.mjs'

const regels = []
let supabaseOk = false
let asanaOk = false

// 1. Supabase: kan de worker de tabel aanvragen lezen?
try {
  const { supabase } = await import('./lib/supabase.mjs')
  const { error } = await supabase().from('aanvragen').select('id').limit(1)
  if (error) throw new Error(error.message)
  supabaseOk = true
  regels.push('Supabase: in orde')
} catch (e) {
  regels.push(`Supabase: MISLUKT — ${e.message}`)
}

// 2. Asana: is de token geldig? /users/me is de goedkoopste vraag die dat bewijst.
const pat = env('ASANA_PAT')
if (!pat) {
  regels.push('Asana: MISLUKT — ASANA_PAT ontbreekt in de omgeving')
} else {
  try {
    const res = await fetch('https://app.asana.com/api/1.0/users/me?opt_fields=name', {
      headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401) throw new Error('401 Not Authorized — de token is ongeldig of ingetrokken')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    asanaOk = true
    regels.push(`Asana: in orde (ingelogd als ${body?.data?.name ?? 'onbekend'})`)
  } catch (e) {
    regels.push(`Asana: MISLUKT — ${e.message}`)
  }
}

for (const r of regels) log(r)

if (!supabaseOk) {
  console.error('\nZonder Supabase kan er niets: geen aanvraag lezen, geen status bijwerken. Stop hier en meld dit.')
  process.exit(2)
}
if (!asanaOk) {
  console.error('\nDe Asana-token deugt niet. Publiceren lukt straks niet, en een foutmelding plaatsen ook niet.')
  console.error('Markeer de aanvraag als mislukt (worker/fail.mjs) en meld dat ASANA_PAT vernieuwd moet worden.')
  process.exit(3)
}
console.log('\nOmgeving in orde.')
