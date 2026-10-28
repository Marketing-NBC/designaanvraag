/**
 * Het weekoverzicht op maandagochtend: welke deadlines er deze week zijn, en waar Marketing op moet
 * letten. Puur: taken erin, mail eruit. Het ophalen uit Asana en het versturen doet
 * scripts/weekmail.mjs.
 *
 * "Deadline" is hier het veld Deadline: wanneer de aanvrager het af wil hebben. De vervaldatum is
 * de planning van Marketing; die staat erbij, zodat opvalt wat nog niet of te laat is ingepland.
 */
import { formatDateShortNl } from './asana-title.ts'
import { MELDING_ONTVANGERS } from './contact.ts'
import { escapeHtml, knop, mailOpmaak, themaVoor } from './mail.ts'
import type { MailBericht, Thema } from './mail.ts'
import { LOCATIES, locatieLabel } from './request-types.ts'
import type { Locatie } from './request-types.ts'

export type SectieSleutel = 'nieuwe_aanvragen' | 'feedback' | 'in_planning' | 'klaar'

export interface WeekTaak {
  naam: string
  url: string
  locatie: Locatie
  /** Het veld Deadline (YYYY-MM-DD). */
  deadline: string | null
  eventdatum: string | null
  /** De vervaldatum van de taak: wanneer Marketing het heeft ingepland. */
  vervaldatum: string | null
  sectie: SectieSleutel | null
  sectieNaam: string | null
  spoed: boolean
}

/** Wat we uit asana-fields.json nodig hebben. */
export interface WeekmailVelden {
  project?: { gid: string } | null
  fields?: Record<string, { gid: string }>
  sections?: Record<string, { gid: string; name?: string }>
}

/** Een taak zoals Asana hem teruggeeft met de opt_fields uit scripts/weekmail.mjs. */
export interface AsanaWeekTaak {
  name?: string
  permalink_url?: string
  due_on?: string | null
  memberships?: { project?: { gid?: string }; section?: { gid?: string; name?: string } | null }[]
  custom_fields?: { gid?: string; date_value?: { date?: string } | null; enum_value?: { name?: string } | null }[]
}

/** Van een Asana-taak naar wat de weekmail nodig heeft. Velden die ontbreken worden null. */
export function taakUitAsana(t: AsanaWeekTaak, cfg: WeekmailVelden): WeekTaak {
  const veld = (sleutel: string) => {
    const gid = cfg.fields?.[sleutel]?.gid
    return gid ? t.custom_fields?.find((c) => c.gid === gid) : undefined
  }
  const datum = (sleutel: string) => veld(sleutel)?.date_value?.date?.slice(0, 10) ?? null
  const keuze = (sleutel: string) => veld(sleutel)?.enum_value?.name?.trim().toLowerCase() ?? ''

  // De kolom uit ons eigen project; een taak staat ook in "4. Werkplanning".
  const sectie = t.memberships?.find((m) => m.project?.gid === cfg.project?.gid)?.section ?? null
  const sleutel = Object.entries(cfg.sections ?? {}).find(([, s]) => s.gid === sectie?.gid)?.[0] as SectieSleutel | undefined
  const locatie = LOCATIES.find((l) => l.label.toLowerCase() === keuze('locatie'))?.key ?? 'nbc'

  return {
    naam: t.name ?? '(zonder naam)',
    url: t.permalink_url ?? '',
    locatie,
    deadline: datum('deadline'),
    eventdatum: datum('eventdatum'),
    vervaldatum: t.due_on ?? null,
    sectie: sleutel ?? null,
    sectieNaam: sectie?.name ?? null,
    spoed: keuze('spoed') === 'ja',
  }
}

const DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']

function dagNummer(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000
}

function isoVan(dag: number): string {
  return new Date(dag * 86_400_000).toISOString().slice(0, 10)
}

/** Maandag t/m zondag van de week waarin `vandaag` valt, plus het ISO-weeknummer. */
export function weekVan(vandaag: string): { maandag: string; zondag: string; weeknummer: number } {
  const n = dagNummer(vandaag)
  // 1970-01-01 was een donderdag; 0 = maandag.
  const dagInWeek = (((n + 3) % 7) + 7) % 7
  const maandag = n - dagInWeek
  // ISO-week: de week waar de donderdag in valt, geteld vanaf de eerste donderdag van dat jaar.
  const donderdag = maandag + 3
  const jaar = new Date(donderdag * 86_400_000).getUTCFullYear()
  const weeknummer = Math.floor((donderdag - Date.UTC(jaar, 0, 1) / 86_400_000) / 7) + 1
  return { maandag: isoVan(maandag), zondag: isoVan(maandag + 6), weeknummer }
}

function plusDagen(iso: string, n: number): string {
  return isoVan(dagNummer(iso) + n)
}

function dagNaam(iso: string): string {
  return DAGEN[(((dagNummer(iso) + 3) % 7) + 7) % 7]
}

function kort(iso: string): string {
  return formatDateShortNl(iso, false)
}

export interface Weekoverzicht {
  week: { maandag: string; zondag: string; weeknummer: number }
  /** Deadlines deze week, per dag (maandag eerst). */
  dezeWeek: { dag: string; taken: WeekTaak[] }[]
  volgendeWeek: WeekTaak[]
  letOp: {
    overDeadline: WeekTaak[]
    nietOpgepakt: WeekTaak[]
    feedback: WeekTaak[]
    naDeadlineIngepland: WeekTaak[]
    nietIngepland: WeekTaak[]
  }
  aantal: number
  spoed: number
}

const opDeadline = (a: WeekTaak, b: WeekTaak) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.naam.localeCompare(b.naam)

/** Zet de open taken om in wat er in de mail komt. Afgeronde taken en de kolom Klaar tellen niet mee. */
export function maakWeekoverzicht(alle: WeekTaak[], vandaag: string): Weekoverzicht {
  const week = weekVan(vandaag)
  const volgendeMaandag = plusDagen(week.maandag, 7)
  const volgendeZondag = plusDagen(week.maandag, 13)
  const open = alle.filter((t) => t.sectie !== 'klaar').sort(opDeadline)

  const inWeek = (t: WeekTaak) => t.deadline !== null && t.deadline >= week.maandag && t.deadline <= week.zondag
  const dezeWeek = DAGEN.map((_, i) => {
    const dag = plusDagen(week.maandag, i)
    return { dag, taken: open.filter((t) => t.deadline === dag) }
  }).filter((d) => d.taken.length)
  const takenDezeWeek = open.filter(inWeek)

  return {
    week,
    dezeWeek,
    volgendeWeek: open.filter((t) => t.deadline !== null && t.deadline >= volgendeMaandag && t.deadline <= volgendeZondag),
    letOp: {
      overDeadline: open.filter((t) => t.deadline !== null && t.deadline < week.maandag),
      nietOpgepakt: open.filter((t) => t.sectie === 'nieuwe_aanvragen'),
      feedback: open.filter((t) => t.sectie === 'feedback'),
      // Wat al over de deadline is, staat daar al; hier alleen wat nog te redden valt.
      naDeadlineIngepland: open.filter((t) => t.vervaldatum !== null && t.deadline !== null && t.deadline >= week.maandag && t.vervaldatum > t.deadline),
      // Wat al in Nieuwe aanvragen staat, staat daar al bij; dit is wat verder is maar geen datum heeft.
      nietIngepland: takenDezeWeek.filter((t) => !t.vervaldatum && t.sectie !== 'nieuwe_aanvragen'),
    },
    aantal: takenDezeWeek.length,
    spoed: takenDezeWeek.filter((t) => t.spoed).length,
  }
}

/**
 * Geen deadlines deze week en niets om op te letten: dan komt er geen mail. Een lege mail elke week
 * leert je alleen hem niet meer te lezen. Deadlines van volgende week wachten tot die maandag.
 */
export function nietsTeMelden(o: Weekoverzicht): boolean {
  return o.aantal === 0 && Object.values(o.letOp).every((l) => l.length === 0)
}

const SPOED = '<span style="display:inline-block;background:#c0392b;color:#ffffff;font-size:11px;font-weight:bold;padding:1px 6px;border-radius:3px;margin-left:6px;">SPOED</span>'

function taakRegel(t: WeekTaak, thema: Thema, extra: string[] = []): string {
  const meta = [
    t.sectieNaam ?? '',
    t.vervaldatum ? `ingepland ${dagNaam(t.vervaldatum)} ${kort(t.vervaldatum)}` : 'nog geen planningsdatum',
    ...extra,
  ].filter(Boolean)
  return `<li style="margin:0 0 8px;"><a href="${escapeHtml(t.url)}" style="color:${thema.link};font-weight:bold;">${escapeHtml(t.naam)}</a>`
    + (t.spoed ? SPOED : '')
    + `<br><span style="color:#596165;font-size:13px;">${escapeHtml(meta.join(' · '))}</span></li>`
}

function lijstMet(thema: Thema, taken: WeekTaak[], extra: (t: WeekTaak) => string[] = () => []): string {
  // Inspringen met margin: Word (de klassieke Outlook) negeert padding op een lijst.
  return `<ul style="margin:4px 0 0 24px;padding:0;">${taken.map((t) => taakRegel(t, thema, extra(t))).join('')}</ul>`
}

function kop(tekst: string): string {
  return `<h2 style="margin:28px 0 8px;font-size:17px;color:#0e0e0e;">${escapeHtml(tekst)}</h2>`
}

function meervoud(n: number, een: string, meer: string): string {
  return `${n} ${n === 1 ? een : meer}`
}

export function renderWeekmail(o: Weekoverzicht, locatie: Locatie, projectUrl: string | null): MailBericht {
  const thema = themaVoor(locatie)
  const lijst = (taken: WeekTaak[], extra?: (t: WeekTaak) => string[]) => lijstMet(thema, taken, extra)
  const { week, letOp } = o
  const periode = `${dagNaam(week.maandag)} ${kort(week.maandag)} t/m ${dagNaam(week.zondag)} ${kort(week.zondag)}`
  const delen: string[] = [`<p style="margin:0;color:#596165;">${escapeHtml(periode)}</p>`]

  // Samenvatting bovenaan: in één oogopslag hoe druk het is.
  const samenvatting = o.aantal
    ? `Deze week ${o.aantal === 1 ? 'staat er' : 'staan er'} <strong>${meervoud(o.aantal, 'deadline', 'deadlines')}</strong>`
      + (o.spoed ? `, waarvan <strong>${o.spoed} spoed</strong>` : '') + '.'
    : 'Er staan deze week <strong>geen deadlines</strong>.'
  delen.push(`<p style="margin:12px 0 0;">${samenvatting}</p>`)

  delen.push(kop('Deadlines deze week'))
  if (o.dezeWeek.length) {
    for (const d of o.dezeWeek) {
      const dag = `${dagNaam(d.dag)} ${kort(d.dag)}`
      delen.push(`<p style="margin:16px 0 0;font-weight:bold;">${escapeHtml(dag[0].toUpperCase() + dag.slice(1))}</p>`)
      delen.push(lijst(d.taken, (t) => (t.eventdatum ? [`event ${dagNaam(t.eventdatum)} ${kort(t.eventdatum)}`] : [])))
    }
  } else {
    delen.push('<p style="margin:0;color:#596165;">Geen deadlines deze week.</p>')
  }

  const punten: string[] = []
  if (letOp.overDeadline.length) {
    punten.push(`<p style="margin:16px 0 0;"><strong>Over de deadline</strong> (nog niet in Klaar)</p>`
      + lijst(letOp.overDeadline, (t) => [`deadline was ${dagNaam(t.deadline!)} ${kort(t.deadline!)}`]))
  }
  if (letOp.nietOpgepakt.length) {
    punten.push(`<p style="margin:16px 0 0;"><strong>Nog niet opgepakt</strong> (staan nog in Nieuwe aanvragen)</p>`
      + lijst(letOp.nietOpgepakt, (t) => (t.deadline ? [`deadline ${dagNaam(t.deadline)} ${kort(t.deadline)}`] : [])))
  }
  if (letOp.feedback.length) {
    punten.push(`<p style="margin:16px 0 0;"><strong>Feedback die op je wacht</strong></p>`
      + lijst(letOp.feedback, (t) => (t.deadline ? [`deadline ${dagNaam(t.deadline)} ${kort(t.deadline)}`] : [])))
  }
  if (letOp.naDeadlineIngepland.length) {
    punten.push(`<p style="margin:16px 0 0;"><strong>Ingepland na de deadline</strong></p>`
      + lijst(letOp.naDeadlineIngepland, (t) => [`deadline ${dagNaam(t.deadline!)} ${kort(t.deadline!)}`]))
  }
  if (letOp.nietIngepland.length) {
    punten.push(`<p style="margin:16px 0 0;"><strong>Deadline deze week, maar nog geen planningsdatum</strong></p>`
      + lijst(letOp.nietIngepland, (t) => [`deadline ${dagNaam(t.deadline!)} ${kort(t.deadline!)}`]))
  }
  delen.push(kop('Let op'))
  delen.push(punten.length ? punten.join('\n') : '<p style="margin:0;color:#596165;">Niets bijzonders: alles is opgepakt en op tijd ingepland.</p>')

  delen.push(kop('Volgende week'))
  delen.push(o.volgendeWeek.length
    ? lijst(o.volgendeWeek, (t) => [`deadline ${dagNaam(t.deadline!)} ${kort(t.deadline!)}`])
    : '<p style="margin:0;color:#596165;">Nog geen deadlines.</p>')

  if (projectUrl) delen.push(knop(projectUrl, 'Open het bord in Asana', thema))

  const aantal = o.aantal ? meervoud(o.aantal, 'deadline', 'deadlines') + (o.spoed ? `, ${o.spoed} spoed` : '') : 'geen deadlines'
  return {
    aan: [MELDING_ONTVANGERS[locatie] ?? MELDING_ONTVANGERS.nbc],
    onderwerp: `Weekoverzicht designaanvragen ${locatieLabel(locatie)} week ${week.weeknummer}: ${aantal}`,
    html: mailOpmaak(
      `Week ${week.weeknummer}: deadlines en aandachtspunten`,
      delen.join('\n'),
      'Elke maandagochtend automatisch verstuurd vanuit het designaanvraag-formulier.',
      thema,
    ),
  }
}
