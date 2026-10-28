import { createClient } from '@supabase/supabase-js'
import type { Aanvraag } from './shared/aanvraag-schema.ts'
import type { Aanvulling, GevondenAanvraag } from './shared/aanvulling-schema.ts'
import { ZOEK_DAGEN, ZOEK_MAX_RESULTATEN, ZOEK_OMSCHRIJVING_TEKENS } from './shared/aanvulling-schema.ts'
import type { Locatie, RequestTypeKey, Soort } from './shared/request-types.ts'

export interface AanvraagRow {
  id: string
  client_request_id: string
  asana_task_gid: string | null
  asana_task_url: string | null
  asana_error: string | null
  /** De mijlpaal op de deadline in het deadlineproject; null als die er niet is. */
  asana_deadline_gid: string | null
  /** Minder dan 10 werkdagen tot het event, bepaald bij het indienen. */
  spoed: boolean
  /** Werkdagen tussen de aanvraag en het event; negatief kan niet, het formulier blokkeert dat. */
  werkdagen_tot_event: number | null
  brand_status: 'pending' | 'running' | 'done' | 'failed' | 'overgeslagen'
  brand_error: string | null
  brand_session_url: string | null
  /**
   * Het menuscherm. Dezelfde vorm als brand_*, met één verschil: de worker doet het
   * werk, dus de function schrijft hier alleen als Marketing op de knop drukt.
   */
  menu_status: 'pending' | 'running' | 'done' | 'failed'
  menu_error: string | null
  /** Welke kleuren de blobs en de kopjes krijgen; gezet vanuit het veld in Asana. */
  menu_kleuren: 'nbc' | 'opdrachtgever'
  /** Gezet toen de Asana-taak werd verwijderd; de aanvraag telt dan niet meer mee. */
  vervallen_op: string | null
}

/**
 * De aanvraag zoals een aanvulling hem nodig heeft: niet alleen de Asana-koppeling maar ook wat er
 * ooit is ingevuld, zodat de function kan zien wat er werkelijk verandert.
 */
export interface AanvraagDetail extends AanvraagRow {
  /** De oorspronkelijke aanvrager; staat in de meldingsmail bij een aanvulling. */
  naam: string
  locatie: Locatie
  soort: Soort
  /** Leeg bij een interne aanvraag. */
  event: string
  /** Null bij een interne aanvraag. */
  event_datum: string | null
  /** Null bij een interne aanvraag zonder deadline. */
  deadline: string | null
  aanvraag_types: RequestTypeKey[]
  anders_tekst: string
  schijf_locatie: string
  /** Bij een interne aanvraag de hele vraag; nodig voor de taaknaam in de meldingsmail. */
  omschrijving: string
}

export interface AanvullingRow {
  id: string
  aanvraag_id: string
  client_request_id: string
  bijgewerkt: string[]
  asana_error: string | null
}

export interface NewAanvulling extends Aanvulling {
  client_request_id: string
  ip_hash: string | null
}

export type BijlageStatus = 'verwacht' | 'gekoppeld' | 'mislukt' | 'geweigerd' | 'opgeruimd'

export interface BijlageRow {
  id: string
  groep_id: string
  bestandsnaam: string
  mime: string
  bytes: number
  storage_path: string
  status: BijlageStatus
  asana_gid: string | null
}

export interface NewBijlage {
  /** Zelf gemunt, want het opslagpad bevat hem: `<groep_id>/<id>.<ext>`. */
  id: string
  groep_id: string
  bestandsnaam: string
  mime: string
  bytes: number
  storage_path: string
  ip_hash: string | null
}

/** Bij welke aanvraag of aanvulling een bijlage hoort; precies één van de twee. */
export type BijlageOuder = { aanvraag_id: string } | { aanvulling_id: string }

export type OpleveringStatus = 'bezig' | 'verstuurd' | 'mislukt'

export interface OpleveringRow {
  id: string
  created_at: string
  aanvraag_id: string
  subtaak_gid: string
  versie: number
  ontvangers: string[]
  bijlagen: { naam: string; bytes: number }[]
  status: OpleveringStatus
  fout: string | null
  verstuurd_op: string | null
}

export interface NewAanvraag extends Aanvraag {
  client_request_id: string
  ip_hash: string | null
  spoed: boolean
  werkdagen_tot_event: number | null
}

export interface Db {
  findByClientRequestId(id: string): Promise<AanvraagRow | null>
  insert(row: NewAanvraag): Promise<AanvraagRow>
  update(id: string, patch: Partial<AanvraagRow>): Promise<void>
  /** De aanvraag achter een Asana-taak; nodig voor de knop "Genereer nu". */
  findByAsanaTaskGid(gid: string): Promise<AanvraagRow | null>
  /** Verhoogt de teller voor `key` in het venster en geeft de nieuwe stand terug. */
  bumpRateLimit(key: string, window: '1 hour' | '1 day'): Promise<number>
  /** De volledige aanvraag, voor het bijwerken vanuit een aanvulling. */
  findById(id: string): Promise<AanvraagDetail | null>
  /** Recente aanvragen voor een evenement waarvan de eventnaam op `q` lijkt, nieuwste eerst. */
  zoekOpEvent(q: string, vandaag: Date): Promise<GevondenAanvraag[]>
  /**
   * Recente interne aanvragen van deze aanvrager, nieuwste eerst. De naam moet precies kloppen
   * (hoofdletters daargelaten): dit is "mijn aanvragen", niet zoeken in die van anderen.
   */
  zoekInternOpNaam(naam: string, vandaag: Date): Promise<GevondenAanvraag[]>
  /**
   * Eén aanvraag op id, voor de feedbacklink in de opleveringsmail. Geen grens in de tijd: feedback
   * kan ook komen op een aanvraag van lang geleden. Wel alleen als hij nog openstaat bij Marketing.
   */
  zoekOpId(id: string): Promise<GevondenAanvraag | null>
  /**
   * Markeert de aanvraag bij deze Asana-taak als vervallen. Geeft terug of er een rij geraakt is,
   * zodat de webhook een taak van buiten dit project kan herkennen.
   */
  markeerVervallen(asanaTaskGid: string, moment: Date): Promise<boolean>
  /**
   * De deadline-mijlpaal van de aanvraag achter deze taak, ook als de aanvraag al vervallen is:
   * juist dan moet de mijlpaal nog opgeruimd worden.
   */
  deadlineVan(asanaTaskGid: string): Promise<string | null>
  findAanvullingByClientRequestId(id: string): Promise<AanvullingRow | null>
  insertAanvulling(row: NewAanvulling): Promise<AanvullingRow>
  updateAanvulling(id: string, patch: Partial<AanvullingRow>): Promise<void>
  insertBijlagen(rows: NewBijlage[]): Promise<void>
  /**
   * Hangt de bijlagen aan hun aanvraag en geeft terug welke dat gelukt is. Voorwaardelijk: alleen
   * rijen die nog nergens bij horen. Zo kan hetzelfde bestand nooit aan twee aanvragen gekoppeld
   * worden, ook niet als iemand dezelfde ids een tweede keer meestuurt.
   */
  claimBijlagen(ids: string[], ouder: BijlageOuder): Promise<BijlageRow[]>
  /** Bijlagen van deze ouder die nog op doorzetten wachten; voor een herhaalde verzending. */
  openBijlagenVan(ouder: BijlageOuder): Promise<BijlageRow[]>
  markeerBijlage(id: string, patch: Partial<BijlageRow> & { fout?: string | null; asana_url?: string | null }): Promise<void>
  /** De volledige aanvraag achter een Asana-taak; voor de opleveringsmail. */
  findDetailByAsanaTaskGid(gid: string): Promise<AanvraagDetail | null>
  /** Het e-mailadres van een collega, op naam (hoofdletters daargelaten). Null als het er niet is. */
  collegaEmail(naam: string): Promise<string | null>
  /** De oplevering die van deze subtaak gemaakt is, als die er al is. */
  findOplevering(subtaakGid: string): Promise<OpleveringRow | null>
  /** Hoeveel opleveringen van deze aanvraag al verstuurd zijn; de volgende is dat plus één. */
  aantalVerstuurd(aanvraagId: string): Promise<number>
  insertOplevering(row: Pick<OpleveringRow, 'aanvraag_id' | 'subtaak_gid' | 'versie' | 'ontvangers' | 'bijlagen'>): Promise<OpleveringRow>
  updateOplevering(id: string, patch: Partial<Omit<OpleveringRow, 'id'>>): Promise<void>
}

const ROW_COLUMNS = 'id, client_request_id, asana_task_gid, asana_task_url, asana_error, asana_deadline_gid, spoed, werkdagen_tot_event, brand_status, brand_error, brand_session_url, menu_status, menu_error, menu_kleuren, vervallen_op'
const DETAIL_COLUMNS = `${ROW_COLUMNS}, naam, locatie, soort, event, event_datum, deadline, aanvraag_types, anders_tekst, schijf_locatie, omschrijving`
const ZOEK_COLUMNS = 'id, soort, event, event_datum, deadline, naam, aanvraag_types, anders_tekst, schijf_locatie, omschrijving'
const AANVULLING_COLUMNS = 'id, aanvraag_id, client_request_id, bijgewerkt, asana_error'
const BIJLAGE_COLUMNS = 'id, groep_id, bestandsnaam, mime, bytes, storage_path, status, asana_gid'
const OPLEVERING_COLUMNS = 'id, created_at, aanvraag_id, subtaak_gid, versie, ontvangers, bijlagen, status, fout, verstuurd_op'

/** Tekens waarmee je in een PostgREST-filter uit de waarde zou kunnen breken. */
function veiligeZoekterm(q: string): string {
  return q.replace(/[%_,()\\*]/g, ' ').trim()
}

/**
 * Een rij uit de database als treffer. De omschrijving gaat alleen mee bij een interne aanvraag,
 * en dan ingekort: bij een evenement herken je de aanvraag aan het event, en de volledige tekst
 * hoort niet op een open endpoint.
 */
function alsTreffer(r: GevondenAanvraag): GevondenAanvraag {
  const omschrijving = r.soort === 'intern' ? (r.omschrijving ?? '').replace(/\s+/g, ' ').trim() : ''
  return {
    ...r,
    soort: r.soort ?? 'evenement',
    aanvraag_types: r.aanvraag_types ?? [],
    omschrijving: omschrijving.length > ZOEK_OMSCHRIJVING_TEKENS ? `${omschrijving.slice(0, ZOEK_OMSCHRIJVING_TEKENS).trimEnd()}…` : omschrijving,
  }
}

export function createDb(url: string, secretKey: string): Db {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async findByClientRequestId(id) {
      const { data, error } = await sb.from('aanvragen').select(ROW_COLUMNS).eq('client_request_id', id).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as AanvraagRow | null) ?? null
    },
    async insert(row) {
      const { data, error } = await sb.from('aanvragen').insert(row).select(ROW_COLUMNS).single()
      if (error) throw new Error(`db insert: ${error.message}`)
      return data as AanvraagRow
    },
    async update(id, patch) {
      const { error } = await sb.from('aanvragen').update(patch).eq('id', id)
      if (error) throw new Error(`db update: ${error.message}`)
    },
    async findByAsanaTaskGid(gid) {
      const { data, error } = await sb.from('aanvragen').select(ROW_COLUMNS)
        .eq('asana_task_gid', gid).is('vervallen_op', null).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as AanvraagRow | null) ?? null
    },
    async bumpRateLimit(key, window) {
      const { data, error } = await sb.rpc('bump_rate_limit', { p_key: key, p_window: window })
      if (error) throw new Error(`db rate limit: ${error.message}`)
      return Number(data)
    },
    async findById(id) {
      const { data, error } = await sb.from('aanvragen').select(DETAIL_COLUMNS).eq('id', id).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as AanvraagDetail | null) ?? null
    },
    async zoekOpEvent(q, vandaag) {
      const term = veiligeZoekterm(q)
      if (!term) return []
      const grens = new Date(vandaag.getTime() - ZOEK_DAGEN * 86_400_000).toISOString()
      const { data, error } = await sb
        .from('aanvragen')
        .select(ZOEK_COLUMNS)
        .eq('soort', 'evenement')
        .ilike('event', `%${term}%`)
        .gte('created_at', grens)
        // Zonder taak valt er niets aan te vullen; die aanvraag hoort niet in de lijst.
        .not('asana_task_gid', 'is', null)
        // Taak verwijderd in Asana? Dan bestaat de aanvraag voor collega's niet meer.
        .is('vervallen_op', null)
        .order('created_at', { ascending: false })
        .limit(ZOEK_MAX_RESULTATEN)
      if (error) throw new Error(`db zoeken: ${error.message}`)
      return ((data as GevondenAanvraag[] | null) ?? []).map(alsTreffer)
    },
    async zoekInternOpNaam(naam, vandaag) {
      const term = veiligeZoekterm(naam)
      if (!term) return []
      const grens = new Date(vandaag.getTime() - ZOEK_DAGEN * 86_400_000).toISOString()
      const { data, error } = await sb
        .from('aanvragen')
        .select(ZOEK_COLUMNS)
        .eq('soort', 'intern')
        // ilike zonder jokertekens: dezelfde naam, alleen de hoofdletters mogen verschillen.
        .ilike('naam', term)
        .gte('created_at', grens)
        .not('asana_task_gid', 'is', null)
        .is('vervallen_op', null)
        .order('created_at', { ascending: false })
        .limit(ZOEK_MAX_RESULTATEN)
      if (error) throw new Error(`db zoeken: ${error.message}`)
      return ((data as GevondenAanvraag[] | null) ?? []).map(alsTreffer)
    },
    async zoekOpId(id) {
      const { data, error } = await sb
        .from('aanvragen')
        .select(ZOEK_COLUMNS)
        .eq('id', id)
        .not('asana_task_gid', 'is', null)
        .is('vervallen_op', null)
        .maybeSingle()
      if (error) throw new Error(`db zoeken: ${error.message}`)
      return data ? alsTreffer(data as GevondenAanvraag) : null
    },
    async markeerVervallen(asanaTaskGid, moment) {
      const { data, error } = await sb
        .from('aanvragen')
        .update({ vervallen_op: moment.toISOString() })
        .eq('asana_task_gid', asanaTaskGid)
        .is('vervallen_op', null)
        .select('id')
      if (error) throw new Error(`db vervallen: ${error.message}`)
      return ((data as unknown[] | null) ?? []).length > 0
    },
    async deadlineVan(asanaTaskGid) {
      const { data, error } = await sb.from('aanvragen').select('asana_deadline_gid').eq('asana_task_gid', asanaTaskGid).limit(1).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as { asana_deadline_gid: string | null } | null)?.asana_deadline_gid ?? null
    },
    async findAanvullingByClientRequestId(id) {
      const { data, error } = await sb.from('aanvullingen').select(AANVULLING_COLUMNS).eq('client_request_id', id).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as AanvullingRow | null) ?? null
    },
    async insertAanvulling(row) {
      const { data, error } = await sb.from('aanvullingen').insert(row).select(AANVULLING_COLUMNS).single()
      if (error) throw new Error(`db insert: ${error.message}`)
      return data as AanvullingRow
    },
    async updateAanvulling(id, patch) {
      const { error } = await sb.from('aanvullingen').update(patch).eq('id', id)
      if (error) throw new Error(`db update: ${error.message}`)
    },
    async insertBijlagen(rows) {
      if (!rows.length) return
      const { error } = await sb.from('bijlagen').insert(rows)
      if (error) throw new Error(`db insert bijlagen: ${error.message}`)
    },
    async claimBijlagen(ids, ouder) {
      if (!ids.length) return []
      const { data, error } = await sb
        .from('bijlagen')
        .update(ouder)
        .in('id', ids)
        .eq('status', 'verwacht')
        .is('aanvraag_id', null)
        .is('aanvulling_id', null)
        .select(BIJLAGE_COLUMNS)
      if (error) throw new Error(`db claim bijlagen: ${error.message}`)
      return (data as BijlageRow[] | null) ?? []
    },
    async openBijlagenVan(ouder) {
      const kolom = 'aanvraag_id' in ouder ? 'aanvraag_id' : 'aanvulling_id'
      const waarde = 'aanvraag_id' in ouder ? ouder.aanvraag_id : ouder.aanvulling_id
      const { data, error } = await sb.from('bijlagen').select(BIJLAGE_COLUMNS).eq(kolom, waarde).eq('status', 'verwacht')
      if (error) throw new Error(`db select bijlagen: ${error.message}`)
      return (data as BijlageRow[] | null) ?? []
    },
    async markeerBijlage(id, patch) {
      const { error } = await sb.from('bijlagen').update(patch).eq('id', id)
      if (error) throw new Error(`db update bijlage: ${error.message}`)
    },
    async findDetailByAsanaTaskGid(gid) {
      const { data, error } = await sb.from('aanvragen').select(DETAIL_COLUMNS)
        .eq('asana_task_gid', gid).is('vervallen_op', null).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as AanvraagDetail | null) ?? null
    },
    async collegaEmail(naam) {
      const term = veiligeZoekterm(naam)
      if (!term) return null
      // ilike zonder jokertekens: dezelfde naam, alleen de hoofdletters mogen verschillen.
      const { data, error } = await sb.from('collegas').select('email').ilike('naam', term).not('email', 'is', null).limit(1)
      if (error) throw new Error(`db collegas: ${error.message}`)
      const email = (data as { email: string | null }[] | null)?.[0]?.email?.trim()
      return email || null
    },
    async findOplevering(subtaakGid) {
      const { data, error } = await sb.from('opleveringen').select(OPLEVERING_COLUMNS).eq('subtaak_gid', subtaakGid).maybeSingle()
      if (error) throw new Error(`db select: ${error.message}`)
      return (data as OpleveringRow | null) ?? null
    },
    async aantalVerstuurd(aanvraagId) {
      const { count, error } = await sb.from('opleveringen').select('id', { count: 'exact', head: true })
        .eq('aanvraag_id', aanvraagId).eq('status', 'verstuurd')
      if (error) throw new Error(`db tellen: ${error.message}`)
      return count ?? 0
    },
    async insertOplevering(row) {
      const { data, error } = await sb.from('opleveringen').insert(row).select(OPLEVERING_COLUMNS).single()
      if (error) throw new Error(`db insert oplevering: ${error.message}`)
      return data as OpleveringRow
    },
    async updateOplevering(id, patch) {
      const { error } = await sb.from('opleveringen').update(patch).eq('id', id)
      if (error) throw new Error(`db update oplevering: ${error.message}`)
    },
  }
}

export interface WebhookStore {
  getSecrets(resource: string): Promise<string[]>
  saveSecret(resource: string, secret: string): Promise<void>
}

/** Secrets van Asana-webhooks (tabel asana_webhooks). */
export function createWebhookStore(url: string, secretKey: string): WebhookStore {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    async getSecrets(resource) {
      const { data, error } = await sb.from('asana_webhooks').select('secret').eq('resource_gid', resource).order('created_at', { ascending: false }).limit(5)
      if (error) throw new Error(`db webhooks: ${error.message}`)
      return ((data as { secret: string }[] | null) ?? []).map((r) => r.secret)
    },
    async saveSecret(resource, secret) {
      const { error } = await sb.from('asana_webhooks').upsert({ resource_gid: resource, secret }, { onConflict: 'resource_gid,secret' })
      if (error) throw new Error(`db webhooks: ${error.message}`)
    },
  }
}
