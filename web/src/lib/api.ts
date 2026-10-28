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

/**
 * De recente interne aanvragen van deze collega. Een interne aanvraag heeft geen event om op te
 * zoeken, dus vind je hem terug op je naam. Net als bij het zoeken: een storing is een lege lijst.
 */
export async function zoekInterneAanvragen(naam: string): Promise<GevondenAanvraag[]> {
  if (!FUNCTIONS_URL || !PUBLISHABLE_KEY) return zoekInternMock(naam)
  try {
    const res = await fetch(`${FUNCTIONS_URL}/aanvraag-zoeken?naam=${encodeURIComponent(naam)}`, { headers: { apikey: PUBLISHABLE_KEY } })
    if (!res.ok) return []
    const body = (await res.json()) as { resultaten?: GevondenAanvraag[] }
    return body.resultaten ?? []
  } catch {
    return []
  }
}

/**
 * Eén aanvraag op id, voor de knop "Feedback geven" in de opleveringsmail. Null als hij niet (meer)
 * bestaat of als het opzoeken mislukt; dan kiest de collega hem zelf.
 */
export async function haalAanvraag(id: string): Promise<GevondenAanvraag | null> {
  if (!FUNCTIONS_URL || !PUBLISHABLE_KEY) {
    return [...zoekMock(''), ...zoekInternMock(COLLEGAS_MOCK[0])].find((a) => a.id === id) ?? null
  }
  try {
    const res = await fetch(`${FUNCTIONS_URL}/aanvraag-zoeken?id=${encodeURIComponent(id)}`, { headers: { apikey: PUBLISHABLE_KEY } })
    if (!res.ok) return null
    const body = (await res.json()) as { resultaten?: GevondenAanvraag[] }
    return body.resultaten?.[0] ?? null
  } catch {
    return null
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
    soort: 'evenement',
    event: 'Zorgcongres 2026',
    event_datum: '2026-12-01',
    deadline: '2026-11-20',
    naam: COLLEGAS_MOCK[0],
    aanvraag_types: ['led_kolom'],
    anders_tekst: '',
    schijf_locatie: '',
    omschrijving: '',
  }
  // Een tweede met een deadline die al voorbij is, om de melding daarover lokaal te kunnen zien.
  const verlopen: GevondenAanvraag = { ...demo, id: '3f2504e0-4f89-41d3-9a0c-0305e82c3303', event: 'Zorgdag 2026', event_datum: '2026-10-01', deadline: '2026-09-25' }
  return [demo, verlopen].filter((d) => d.event.toLowerCase().includes(q.trim().toLowerCase()))
}

/** Twee verzonnen interne aanvragen voor de eerste mock-collega, zodat de keuzelijst iets toont. */
function zoekInternMock(naam: string): GevondenAanvraag[] {
  if (naam.trim().toLowerCase() !== COLLEGAS_MOCK[0].toLowerCase()) return []
  const basis: GevondenAanvraag = {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
    soort: 'intern',
    event: '',
    event_datum: null,
    deadline: '2026-12-04',
    naam: COLLEGAS_MOCK[0],
    aanvraag_types: [],
    anders_tekst: '',
    schijf_locatie: '',
    omschrijving: 'Nieuwe visitekaartjes voor het salesteam, met de nieuwe functietitels.',
  }
  return [
    basis,
    { ...basis, id: '3f2504e0-4f89-41d3-9a0c-0305e82c3305', deadline: '2026-10-02', omschrijving: 'Poster voor de kantine over de nieuwe lunchtijden.' },
  ]
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
