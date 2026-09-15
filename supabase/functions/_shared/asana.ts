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
  project: { gid: string; name?: string; url?: string; workspace_gid?: string } | null
  assignee: { gid: string; name?: string } | null
  fields: Record<string, AsanaField>
  /** Secties van het bord (nieuwe_aanvragen, in_planning, mee_bezig, klaar). */
  sections?: Record<string, { gid: string; name?: string }>
  /** Project waar ingeplande taken ook in komen ("4. Werkplanning"). */
  planning_project?: { gid: string; name?: string; url?: string } | null
}

export const asanaFields = fieldsJson as unknown as AsanaFieldsConfig

export interface TaskInput {
  name: string
  htmlNotes: string
  plainNotes: string
  projectGid: string
  /** Sectie waarin de taak landt (bord-kolom "Nieuwe aanvragen"); null = standaardsectie. */
  sectionGid: string | null
  assigneeGid: string | null
  /** Geen vervaldatum: die kiest Marketing zelf bij het inplannen. */
  customFields: Record<string, unknown>
  /** Eén subtaak per aangevraagd type (alleen bij meer dan één type). */
  subtasks: string[]
}

export interface AsanaClient {
  /** `warnings` bevat wat Asana geweigerd heeft; de taak bestaat dan wel. Leeg = alles gelukt. */
  createTask(input: TaskInput): Promise<{ gid: string; url: string; subtasks: number; warnings: string[] }>
  /** Gid van de enum-optie met deze naam; maakt hem aan als hij nog niet bestaat. */
  enumOptie(fieldGid: string, naam: string): Promise<string>
}

export interface AsanaTask {
  gid: string
  name: string
  dueOn: string | null
  completed: boolean
  assignee: string | null
  projects: string[]
  memberships: { project: string; section: string | null }[]
}

/** Leesbewerkingen en kleine mutaties op één taak, voor de webhook-function. */
export interface AsanaTaskClient {
  getTask(gid: string): Promise<AsanaTask>
  addToProject(taskGid: string, projectGid: string): Promise<void>
  /** Teksten van bestaande comments (om dubbele vragen te voorkomen). */
  listComments(taskGid: string): Promise<string[]>
  addComment(taskGid: string, htmlText: string): Promise<void>
}

/**
 * Bouwt de custom_fields-map op basis van shared/asana-fields.json. Onbekende velden/opties worden
 * overgeslagen. `opties.spoed` komt uit de handler, die hem één keer berekent met de Nederlandse
 * datum van dat moment.
 */
export function buildCustomFields(
  a: Aanvraag,
  cfg: AsanaFieldsConfig = asanaFields,
  opties: { spoed?: boolean; aanvragerOptieGid?: string | null } = {},
): Record<string, unknown> {
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
    // De optie-gids staan niet in asana-fields.json: dat bestand zit in een publieke repo en namen
    // van collega's horen daar niet in. De handler zoekt de optie bij het indienen op via de API.
    const gid = opties.aanvragerOptieGid ?? aanvrager.options?.[a.naam]
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
  if (website?.type === 'text' && a.website) out[website.gid] = a.website

  const schijf = f['schijf']
  if (schijf?.type === 'text' && a.schijf_locatie) out[schijf.gid] = a.schijf_locatie

  const spoedVeld = f['spoed']
  if (spoedVeld && opties.spoed !== undefined) {
    const sleutel = opties.spoed ? 'ja' : 'nee'
    if (spoedVeld.type === 'enum') {
      const gid = spoedVeld.options?.[sleutel]
      if (gid) out[spoedVeld.gid] = gid
    } else if (spoedVeld.type === 'text') {
      out[spoedVeld.gid] = opties.spoed ? 'Ja' : 'Nee'
    }
  }

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

const ok = (status: number) => status >= 200 && status < 300

/**
 * Maakt de taak aan in stappen: eerst de taak zelf, daarna de bord-kolom, de custom fields en de
 * subtaken. Elk onderdeel is een eigen call, zodat één onderdeel dat Asana weigert de rest niet
 * meesleept — eerder zat alles in één POST en leverde een geweigerd veld een taak zónder velden op.
 * Wat niet lukte komt in `warnings` te staan (en dus in de kolom `asana_error`).
 */
export function createAsanaClient(pat: string): AsanaClient {
  return {
    async createTask(input) {
      const warnings: string[] = []

      // 1. De taak zelf: naam, project, assignee en beschrijving.
      const base: Record<string, unknown> = { name: input.name, projects: [input.projectGid] }
      if (input.assigneeGid) base.assignee = input.assigneeGid
      const attempts: { label: string; data: Record<string, unknown> }[] = [
        { label: 'met opmaak', data: { ...base, html_notes: input.htmlNotes } },
        { label: 'platte beschrijving', data: { ...base, notes: input.plainNotes } },
        { label: 'zonder assignee', data: { name: input.name, projects: [input.projectGid], notes: input.plainNotes } },
      ]

      let created: Record<string, unknown> | null = null
      let lastError = 'onbekende fout'
      for (const attempt of attempts) {
        const { status, body } = await asanaFetch(pat, '/tasks', { method: 'POST', body: JSON.stringify({ data: attempt.data }) })
        if (ok(status) && body.data?.gid) {
          if (attempt.label !== 'met opmaak') warnings.push(`taak aangemaakt als "${attempt.label}" (${lastError})`)
          created = body.data
          break
        }
        lastError = `${status}: ${errorText(body)}`
        // Alleen bij 400 (ongeldige invoer) is een simpelere variant zinvol; 401/403/404/5xx niet.
        if (status !== 400) break
      }
      if (!created) throw new Error(`Asana-taak aanmaken mislukt (${lastError})`)

      const gid = String(created.gid)
      const url = String(created.permalink_url ?? `https://app.asana.com/0/${input.projectGid}/${gid}`)

      // 2. In de juiste bord-kolom. Een aparte call is betrouwbaarder dan `memberships` bij aanmaken.
      if (input.sectionGid) {
        const { status, body } = await asanaFetch(pat, `/sections/${input.sectionGid}/addTask`, { method: 'POST', body: JSON.stringify({ data: { task: gid } }) })
        if (!ok(status)) warnings.push(`kolom zetten mislukt (${status}: ${errorText(body)})`)
      }

      // 3. Custom fields. Lukt de hele set niet, dan veld voor veld: één verkeerd gemapt veld hoort
      //    de andere niet mee te nemen, en zo staat precies in de log welk veld het is.
      const veldGids = Object.keys(input.customFields)
      if (veldGids.length) {
        const heel = await asanaFetch(pat, `/tasks/${gid}`, { method: 'PUT', body: JSON.stringify({ data: { custom_fields: input.customFields } }) })
        if (!ok(heel.status)) {
          const geweigerd: string[] = []
          for (const veld of veldGids) {
            const los = await asanaFetch(pat, `/tasks/${gid}`, { method: 'PUT', body: JSON.stringify({ data: { custom_fields: { [veld]: input.customFields[veld] } } }) })
            if (!ok(los.status)) geweigerd.push(`${veldNaam(veld)} (${los.status}: ${errorText(los.body)})`)
          }
          warnings.push(
            geweigerd.length
              ? `velden niet gezet: ${geweigerd.join(', ')}`
              : `velden pas los gezet (samen: ${heel.status}: ${errorText(heel.body)})`,
          )
        }
      }

      return { gid, url, subtasks: await createSubtasks(pat, gid, input), warnings }
    },

    async enumOptie(fieldGid, naam) {
      const gezocht = naam.trim().toLowerCase()
      const huidig = await asanaFetch(pat, `/custom_fields/${fieldGid}?opt_fields=enum_options.gid,enum_options.name,enum_options.enabled`, { method: 'GET' })
      if (!ok(huidig.status)) throw new Error(`Opties ophalen mislukt (${huidig.status}: ${errorText(huidig.body)})`)
      const opties = (huidig.body.data?.enum_options ?? []) as { gid: string; name?: string; enabled?: boolean }[]
      const bestaand = opties.find((o) => o.name?.trim().toLowerCase() === gezocht)
      if (bestaand) {
        // Ooit uitgezet in Asana? Weer aanzetten, anders kan de waarde niet gebruikt worden.
        if (bestaand.enabled === false) {
          await asanaFetch(pat, `/enum_options/${bestaand.gid}`, { method: 'PUT', body: JSON.stringify({ data: { enabled: true } }) })
        }
        return bestaand.gid
      }
      const nieuw = await asanaFetch(pat, `/custom_fields/${fieldGid}/enum_options`, {
        method: 'POST',
        body: JSON.stringify({ data: { name: naam.trim(), enabled: true } }),
      })
      if (!ok(nieuw.status) || !nieuw.body.data?.gid) throw new Error(`Optie "${naam}" aanmaken mislukt (${nieuw.status}: ${errorText(nieuw.body)})`)
      return String(nieuw.body.data.gid)
    },
  }
}

/** Onze sleutel bij een veld-gid, zodat een waarschuwing leesbaar is ("deadline" i.p.v. een getal). */
function veldNaam(gid: string, cfg: AsanaFieldsConfig = asanaFields): string {
  const hit = Object.entries(cfg.fields ?? {}).find(([, f]) => f.gid === gid)
  return hit ? `${hit[0]} (${hit[1].name ?? gid})` : gid
}

/** Subtaken zijn een extra; een fout hier mag de aanvraag niet laten falen. */
async function createSubtasks(pat: string, parentGid: string, input: TaskInput): Promise<number> {
  let made = 0
  for (const name of input.subtasks) {
    const data: Record<string, unknown> = { name, parent: parentGid }
    if (input.assigneeGid) data.assignee = input.assigneeGid
    const { status, body } = await asanaFetch(pat, '/tasks', { method: 'POST', body: JSON.stringify({ data }) })
    if (status >= 200 && status < 300) made++
    else console.warn(`[asana] subtaak "${name}" mislukt: ${status}: ${errorText(body)}`)
  }
  return made
}

export function createAsanaTaskClient(pat: string): AsanaTaskClient {
  return {
    async getTask(gid) {
      const { status, body } = await asanaFetch(
        pat,
        `/tasks/${gid}?opt_fields=name,due_on,completed,assignee.gid,projects.gid,memberships.project.gid,memberships.section.gid`,
        { method: 'GET' },
      )
      if (!ok(status) || !body.data) throw new Error(`Asana-taak ${gid} ophalen mislukt (${status}: ${errorText(body)})`)
      const d = body.data as {
        name?: string
        due_on?: string | null
        completed?: boolean
        assignee?: { gid: string } | null
        projects?: { gid: string }[]
        memberships?: { project?: { gid: string }; section?: { gid: string } | null }[]
      }
      return {
        gid,
        name: String(d.name ?? ''),
        dueOn: d.due_on ?? null,
        completed: Boolean(d.completed),
        assignee: d.assignee?.gid ?? null,
        projects: (d.projects ?? []).map((p) => p.gid),
        memberships: (d.memberships ?? []).filter((m) => m.project?.gid).map((m) => ({ project: m.project!.gid, section: m.section?.gid ?? null })),
      }
    },
    async addToProject(taskGid, projectGid) {
      const { status, body } = await asanaFetch(pat, `/tasks/${taskGid}/addProject`, { method: 'POST', body: JSON.stringify({ data: { project: projectGid } }) })
      if (!ok(status)) throw new Error(`Taak aan project toevoegen mislukt (${status}: ${errorText(body)})`)
    },
    async listComments(taskGid) {
      const { status, body } = await asanaFetch(pat, `/tasks/${taskGid}/stories?limit=100&opt_fields=text,resource_subtype`, { method: 'GET' })
      if (!ok(status)) throw new Error(`Comments ophalen mislukt (${status}: ${errorText(body)})`)
      const rows = (body.data as unknown as { text?: string; resource_subtype?: string }[] | undefined) ?? []
      return rows.filter((r) => r.resource_subtype === 'comment_added').map((r) => String(r.text ?? ''))
    },
    async addComment(taskGid, htmlText) {
      const { status, body } = await asanaFetch(pat, `/tasks/${taskGid}/stories`, { method: 'POST', body: JSON.stringify({ data: { html_text: htmlText } }) })
      if (!ok(status)) throw new Error(`Comment plaatsen mislukt (${status}: ${errorText(body)})`)
    },
  }
}
