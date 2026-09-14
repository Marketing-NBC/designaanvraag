import type { Aanvraag } from './shared/aanvraag-schema.ts'
import { DESIGN_MODES, describeRequestTypes } from './shared/request-types.ts'
import fieldsJson from './shared/asana-fields.json' with { type: 'json' }

const API = 'https://app.asana.com/api/1.0'

export interface AsanaField {
  gid: string
  name: string
  type: 'date' | 'enum' | 'multi_enum' | 'text' | 'number' | string
  options?: Record<string, string>
}

export interface AsanaFieldsConfig {
  project: { gid: string; name?: string; url?: string } | null
  assignee: { gid: string; name?: string } | null
  fields: Record<string, AsanaField>
}

export const asanaFields = fieldsJson as unknown as AsanaFieldsConfig

export interface TaskInput {
  name: string
  htmlNotes: string
  plainNotes: string
  projectGid: string
  assigneeGid: string | null
  dueOn: string
  customFields: Record<string, unknown>
}

export interface AsanaClient {
  createTask(input: TaskInput): Promise<{ gid: string; url: string }>
}

/** Bouwt de custom_fields-map op basis van shared/asana-fields.json. Onbekende velden/opties worden overgeslagen. */
export function buildCustomFields(a: Aanvraag, cfg: AsanaFieldsConfig = asanaFields): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const f = cfg.fields ?? {}

  const dateField = (key: string, iso: string) => {
    const fld = f[key]
    if (fld?.type === 'date') out[fld.gid] = { date: iso }
  }
  dateField('eventdatum', a.event_datum)
  dateField('deadline', a.deadline)

  const aanvrager = f['aanvrager']
  if (aanvrager?.type === 'enum') {
    const gid = aanvrager.options?.[a.naam]
    if (gid) out[aanvrager.gid] = gid
  } else if (aanvrager?.type === 'text') {
    out[aanvrager.gid] = a.naam
  }

  const type = f['type']
  if (type?.type === 'multi_enum') {
    const gids = a.aanvraag_types.map((k) => type.options?.[k]).filter((g): g is string => Boolean(g))
    if (gids.length) out[type.gid] = gids
  } else if (type?.type === 'enum') {
    const gid = type.options?.[a.aanvraag_types[0]]
    if (gid) out[type.gid] = gid
  } else if (type?.type === 'text') {
    out[type.gid] = describeRequestTypes(a.aanvraag_types, a.anders_tekst)
  }

  const modus = f['modus']
  if (modus?.type === 'enum') {
    const gid = modus.options?.[a.design_modus]
    if (gid) out[modus.gid] = gid
  } else if (modus?.type === 'text') {
    out[modus.gid] = DESIGN_MODES.find((m) => m.key === a.design_modus)?.label ?? a.design_modus
  }

  const website = f['website']
  if (website?.type === 'text') out[website.gid] = a.website

  const schijf = f['schijf']
  if (schijf?.type === 'text' && a.schijf_locatie) out[schijf.gid] = a.schijf_locatie

  return out
}

interface AsanaError {
  message?: string
  help?: string
}

async function asanaFetch(pat: string, path: string, init: RequestInit): Promise<{ status: number; body: { data?: Record<string, unknown>; errors?: AsanaError[] } }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

function errorText(body: { errors?: AsanaError[] }): string {
  return body.errors?.map((e) => e.message).filter(Boolean).join('; ') ?? 'onbekende fout'
}

/**
 * Maakt de taak aan. Bij een 400 op custom fields of html_notes valt hij terug op een simpelere taak,
 * zodat een verkeerd gemapt veld nooit de aanvraag blokkeert.
 */
export function createAsanaClient(pat: string): AsanaClient {
  return {
    async createTask(input) {
      const base: Record<string, unknown> = {
        name: input.name,
        projects: [input.projectGid],
        due_on: input.dueOn,
      }
      if (input.assigneeGid) base.assignee = input.assigneeGid

      const attempts: { label: string; data: Record<string, unknown> }[] = [
        { label: 'volledig', data: { ...base, html_notes: input.htmlNotes, custom_fields: input.customFields } },
        { label: 'zonder custom fields', data: { ...base, html_notes: input.htmlNotes } },
        { label: 'platte notes', data: { ...base, notes: input.plainNotes } },
        { label: 'zonder assignee', data: { name: input.name, projects: [input.projectGid], due_on: input.dueOn, notes: input.plainNotes } },
      ]

      let lastError = 'onbekende fout'
      for (const attempt of attempts) {
        if (attempt.label === 'zonder custom fields' && Object.keys(input.customFields).length === 0) continue
        const { status, body } = await asanaFetch(pat, '/tasks', { method: 'POST', body: JSON.stringify({ data: attempt.data }) })
        if (status >= 200 && status < 300 && body.data?.gid) {
          if (attempt.label !== 'volledig') console.warn(`[asana] taak aangemaakt met fallback "${attempt.label}": ${lastError}`)
          return { gid: String(body.data.gid), url: String(body.data.permalink_url ?? `https://app.asana.com/0/${input.projectGid}/${body.data.gid}`) }
        }
        lastError = `${status}: ${errorText(body)}`
        // Alleen bij 400 (ongeldige invoer) is een simpelere variant zinvol; 401/403/404/5xx niet.
        if (status !== 400) break
      }
      throw new Error(`Asana-taak aanmaken mislukt (${lastError})`)
    },
  }
}
