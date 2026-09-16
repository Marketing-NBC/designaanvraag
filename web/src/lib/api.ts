import type { SubmitPayload, SubmitResult } from '../../../shared/aanvraag-schema'
import type { AanvullingPayload, AanvullingResult, GevondenAanvraag } from '../../../shared/aanvulling-schema'
import type { UploadLink, UploadlinkPayload, UploadlinkResult } from '../../../shared/bijlagen'
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

/** Vraagt tijdelijke uploadlinks aan, één per bestand. Zonder backend verzinnen we ze. */
export async function vraagUploadlinks(payload: UploadlinkPayload): Promise<UploadLink[]> {
  if (!FUNCTIONS_URL || !PUBLISHABLE_KEY) {
    await new Promise((r) => setTimeout(r, 250))
    return payload.bestanden.map((b) => ({ bijlage_id: crypto.randomUUID(), bestandsnaam: b.naam, signed_url: 'mock://upload' }))
  }

  const res = await fetch(`${FUNCTIONS_URL}/bijlage-uploadlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as (UploadlinkResult & { error?: string; bestand?: number | null }) | null
  if (!res.ok || !body) throw new ApiError(res.status, body?.error ?? `Uploaden mislukt (${res.status})`)
  return body.links
}

/**
 * Zet het bestand rechtstreeks in de opslag. Met XMLHttpRequest en niet met fetch: alleen die kan
 * vertellen hoe ver de upload is, en bij een bestand van tientallen megabytes wil je een balk zien.
 */
export function uploadBestand(link: UploadLink, file: File, onVoortgang: (deel: number) => void): Promise<void> {
  if (link.signed_url === 'mock://upload') {
    return new Promise((resolve) => {
      let deel = 0
      const timer = window.setInterval(() => {
        deel = Math.min(1, deel + 0.25)
        onVoortgang(deel)
        if (deel >= 1) {
          window.clearInterval(timer)
          resolve()
        }
      }, 120)
    })
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', link.signed_url)
    // Het type moet mee: de opslag controleert hierop, en zonder deze kop wordt het text/plain.
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.setRequestHeader('Cache-Control', 'max-age=3600')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onVoortgang(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      // 413 komt van de opslag zelf als het bestand alsnog te groot blijkt.
      else reject(new ApiError(xhr.status, xhr.status === 413 ? 'Dit bestand is te groot.' : `Uploaden mislukt (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Uploaden mislukt. Controleer je verbinding.'))
    xhr.onabort = () => reject(new Error('Uploaden afgebroken.'))
    xhr.send(file)
  })
}
