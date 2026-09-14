import type { Draft } from '../state'

const KEY = 'nbc-designaanvraag:draft:v1'
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3 // 3 dagen

interface Stored {
  savedAt: number
  draft: Draft
  step: number
}

export function loadDraft(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed || typeof parsed !== 'object' || !parsed.draft) return null
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveDraft(draft: Draft, step: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), draft, step } satisfies Stored))
  } catch {
    /* privémodus of vol: stil negeren */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* negeren */
  }
}

/** Is er iets ingevuld dat de moeite waard is om te herstellen? */
export function draftHasContent(d: Draft): boolean {
  return Boolean(d.naam || d.event || d.event_datum || d.deadline || d.website || d.aanvraag_types.length || d.omschrijving)
}
