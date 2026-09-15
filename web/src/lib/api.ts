import type { SubmitPayload, SubmitResult } from '../../../shared/aanvraag-schema'
import type { AanvullingPayload, AanvullingResult, GevondenAanvraag } from '../../../shared/aanvulling-schema'
import { COLLEGAS_MOCK } from '../data/collegas.fallback'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1` : null
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Verstuurt de aanvraag naar de edge function. Zonder geconfigureerde backend (lokale ontwikkeling,
 * of zolang M2 nog niet live is) simuleert dit een geslaagde verzending.
 */
export async function submitAanvraag(payload: SubmitPayload): Promise<SubmitResult> {
  if (!FUNCTIONS_URL || !PUBLISHABLE_KEY) {
    await new Promise((r) => setTimeout(r, 900))
    console.info('[mock submit]', payload)
    return { aanvraag_id: payload.client_request_id, asana_task_url: null, brand_dispatched: false }
  }

  const res = await fetch(`${FUNCTIONS_URL}/submit-aanvraag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as (SubmitResult & { error?: string }) | null
  if (!res.ok || !body) {
    throw new ApiError(res.status, body?.error ?? `Verzenden mislukt (${res.status})`)
  }
  return body
}

export type BrandStatus = 'pending' | 'running' | 'done' | 'failed' | 'overgeslagen'

/** Status van de huisstijl-extractie; null als er geen backend is of de aanvraag onbekend is. */
export async function fetchStatus(aanvraagId: string): Promise<{ brand_status: BrandStatus; asana_task_url: string | null } | null> {
  if (!FUNCTIONS_URL || !PUBLISHABLE_KEY) return null
  try {
    const res = await fetch(`${FUNCTIONS_URL}/aanvraag-status?id=${encodeURIComponent(aanvraagId)}`, { headers: { apikey: PUBLISHABLE_KEY } })
    if (!res.ok) return null
    return (await res.json()) as { brand_status: BrandStatus; asana_task_url: string | null }
  } catch {
    return null
  }
}

/** Namenlijst uit Supabase; zonder backend (mock-modus) verzonnen namen, bij een storing de fallback. */
export async function fetchCollegas(fallback: string[]): Promise<string[]> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!base || !PUBLISHABLE_KEY) return COLLEGAS_MOCK
  try {
    const res = await fetch(`${base}/rest/v1/collegas_public?select=naam&order=volgorde,naam`, {
      headers: { apikey: PUBLISHABLE_KEY },
    })
    if (!res.ok) return fallback
    const rows = (await res.json()) as { naam: string }[]
    const names = rows.map((r) => r.naam).filter(Boolean)
    return names.length ? names : fallback
  } catch {
    return fallback
  }
}

/**
 * Zoekt eerdere aanvragen op eventnaam, om er een aanvulling op te kunnen sturen. Een storing geeft
 * een lege lijst: het formulier laat dan "niets gevonden" zien in plaats van een foutmelding die de
 * collega toch niet kan oplossen.
 */
export async function zoekAanvragen(q: string): Promise<GevondenAanvraag[]> {
  if (!FUNCTIONS_URL || !PUBLISHABLE_KEY) return zoekMock(q)
  try {
    const res = await fetch(`${FUNCTIONS_URL}/aanvraag-zoeken?q=${encodeURIComponent(q)}`, { headers: { apikey: PUBLISHABLE_KEY } })
    if (!res.ok) return []
    const body = (await res.json()) as { resultaten?: GevondenAanvraag[] }
    return body.resultaten ?? []
  } catch {
    return []
  }
}

export async function verstuurAanvulling(payload: AanvullingPayload): Promise<AanvullingResult> {
  if (!FUNCTIONS_URL || !PUBLISHABLE_KEY) {
    await new Promise((r) => setTimeout(r, 900))
    console.info('[mock aanvulling]', payload)
    return { aanvulling_id: payload.client_request_id, bijgewerkt: [] }
  }

  const res = await fetch(`${FUNCTIONS_URL}/aanvulling-toevoegen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as (AanvullingResult & { error?: string }) | null
  if (!res.ok || !body) throw new ApiError(res.status, body?.error ?? `Versturen mislukt (${res.status})`)
  return body
}

/** Eén verzonnen treffer zodat de flow lokaal te doorlopen is zonder backend. */
function zoekMock(q: string): GevondenAanvraag[] {
  const demo: GevondenAanvraag = {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    event: 'Zorgcongres 2026',
    event_datum: '2026-12-01',
    deadline: '2026-11-20',
    naam: COLLEGAS_MOCK[0],
    aanvraag_types: ['led_kolom'],
    anders_tekst: '',
    schijf_locatie: '',
  }
  return demo.event.toLowerCase().includes(q.trim().toLowerCase()) ? [demo] : []
}
