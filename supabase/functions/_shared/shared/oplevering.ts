/**
 * De opleveringsmail: Marketing laat weten dat het ontwerp klaar is.
 *
 * Zo gaat het in Asana: elke aanvraag heeft een subtaak "Oplevering". De beschrijving daarvan is de
 * tekst van de mail, de bijlagen ervan zijn precies de bestanden die meegaan. Wat je in die subtaak
 * ziet, is wat er verstuurd wordt. Daarna zet Marketing het veld Oplevermail op de hoofdtaak op
 * "Verstuur nu", of eerst op "Stuur proef naar mij". Extra ontvangers staan in het veld "Ook mailen
 * naar".
 *
 * Puur: gegevens erin, keuzes en HTML eruit. Ophalen uit Asana en versturen doet de webhook.
 */
import { formatDateShortNl, kortVan } from './asana-title.ts'
import { formatBytes } from './bijlagen.ts'
import { FORMULIER_URL } from './contact.ts'
import { THEMAS, escapeHtml, gegevensTabel, knop, mailOpmaak, ruimte, themaVoor, vlak, waarschuwingBlok } from './mail.ts'
import type { MailBericht, Thema } from './mail.ts'
import type { PreviewInMail } from './ledkolom-preview.ts'
import { describeRequestTypes } from './request-types.ts'
import type { Locatie, RequestTypeKey, Soort } from './request-types.ts'

/**
 * Samen niet meer dan dit aan bijlagen. Een mail van 20 MB wordt na het inpakken zo'n 27 MB, en
 * daar houden de meeste postvakken op (Gmail bij 25 MB, Outlook standaard bij 35 MB). Wat groter
 * is hoort op de schijf of in SharePoint, met de link of het pad in de beschrijving.
 */
export const MAX_OPLEVERING_BYTES = 20 * 1024 * 1024

/** De naam van de subtaak waar de oplevering in klaargezet wordt. */
export const OPLEVER_SUBTAAK = 'Oplevering'

/** Een subtaak waarvan de naam met "Oplevering" begint; hoofdletters maken niet uit. */
export function isOpleverSubtaak(naam: string): boolean {
  return /^\s*oplevering\b/i.test(naam)
}

export interface Subtaak {
  gid: string
  naam: string
  completed: boolean
  /** ISO-tijdstip. */
  createdAt: string
  /** De opgemaakte beschrijving zoals Asana hem bewaart; daar maken we de mail van. */
  html: string
}

/**
 * De subtaak die nu opgeleverd wordt: de open (niet afgevinkte) Oplevering-subtaak. Zijn er
 * meer, dan de nieuwste. Afgevinkte zijn eerdere versies die al verstuurd zijn.
 */
export function openOpleverSubtaak(subtaken: Subtaak[]): Subtaak | null {
  const open = subtaken.filter((s) => !s.completed && isOpleverSubtaak(s.naam))
  if (!open.length) return null
  return open.reduce((a, b) => (Date.parse(b.createdAt) >= Date.parse(a.createdAt) ? b : a))
}

/** Na het versturen: "Oplevering versie 2 - verstuurd 28 oktober". */
export function verstuurdeSubtaakNaam(versie: number, datum: string): string {
  return `${OPLEVER_SUBTAAK} versie ${versie} - verstuurd ${formatDateShortNl(datum, false)}`
}

export interface AsanaBestand {
  gid: string
  naam: string
  /** Bytes; alleen bekend bij bestanden die in Asana zelf staan. */
  bytes: number | null
  createdAt: string
  /** "asana" voor een geüpload bestand; anders een koppeling naar bijvoorbeeld OneDrive of Google Drive. */
  host: string
  /** Waar een gekoppeld bestand te openen is. Bij een geüpload bestand niet nodig. */
  viewUrl: string | null
}

export interface BijlageKeuze {
  /** Geüploade bestanden: die gaan als bijlage mee. */
  bestanden: AsanaBestand[]
  /** Gekoppelde bestanden (OneDrive, Google Drive, …): die gaan als link mee. */
  links: AsanaBestand[]
  totaalBytes: number
}

/** De bijlagen van de subtaak, in de volgorde waarin ze erbij kwamen. */
export function verdeelBijlagen(bestanden: AsanaBestand[]): BijlageKeuze {
  const op = [...bestanden].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const geupload = op.filter((b) => b.host === 'asana')
  return {
    bestanden: geupload,
    links: op.filter((b) => b.host !== 'asana' && b.viewUrl),
    totaalBytes: geupload.reduce((n, b) => n + (b.bytes ?? 0), 0),
  }
}

/** Wat er te groot is, als zin voor in Asana; null als het past. */
export function teGrootMelding(keuze: BijlageKeuze, max = MAX_OPLEVERING_BYTES): string | null {
  if (keuze.totaalBytes <= max) return null
  const lijst = keuze.bestanden.map((b) => `${b.naam} (${formatBytes(b.bytes ?? 0)})`).join(', ')
  return `De bestanden in de subtaak Oplevering zijn samen ${formatBytes(keuze.totaalBytes)}, en er past hooguit ${formatBytes(max)} in een mail: ${lijst}. `
    + 'Zet ze op de schijf of in SharePoint, haal ze uit de subtaak en zet de link of het pad in de beschrijving.'
}

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i

/**
 * De adressen uit het veld "Ook mailen naar". Gescheiden door komma's, puntkomma's, spaties of
 * regels; "Naam <adres>" zoals je het uit Outlook plakt mag ook.
 */
export function leesOntvangers(tekst: string | null | undefined): { geldig: string[]; ongeldig: string[] } {
  const geldig: string[] = []
  const ongeldig: string[] = []
  const neem = (stuk: string) => {
    const adres = stuk.trim().replace(/^mailto:/i, '')
    if (!adres) return
    if (EMAIL.test(adres)) geldig.push(adres)
    else ongeldig.push(adres)
  }
  // Eerst in groepen op komma, puntkomma of regel, maar niet binnen aanhalingstekens:
  // "Vries, Piet" <piet@x.nl> is één ontvanger.
  for (const groep of (tekst ?? '').match(/(?:"[^"]*"|[^,;\n"])+/g) ?? []) {
    const haakjes = /<([^>]*)>/.exec(groep)
    if (haakjes) neem(haakjes[1])
    else groep.split(/\s+/).forEach(neem)
  }
  return { geldig, ongeldig }
}

/** Zonder dubbelen, hoofdletters daargelaten; de eerste schrijfwijze blijft. */
export function uniekeAdressen(adressen: string[]): string[] {
  const gezien = new Set<string>()
  return adressen.filter((a) => {
    const k = a.trim().toLowerCase()
    if (!k || gezien.has(k)) return false
    gezien.add(k)
    return true
  })
}

const TOEGESTAAN: Record<string, string> = {
  strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', s: 's', code: 'code',
  ul: 'ul', ol: 'ol', li: 'li', blockquote: 'blockquote', pre: 'pre', h1: 'strong', h2: 'strong',
}
const STIJL: Record<string, string> = {
  // Inspringen met margin: Word negeert padding op een lijst.
  ul: 'margin:4px 0 4px 24px;padding:0;',
  ol: 'margin:4px 0 4px 24px;padding:0;',
  li: 'margin:0 0 2px;',
  blockquote: 'margin:4px 0;padding:0 0 0 12px;border-left:3px solid #c9d1d3;color:#596165;',
  pre: 'margin:4px 0;font-family:Consolas,monospace;white-space:pre-wrap;',
}

function ontEntiteit(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function attribuut(attrs: string, naam: string): string | null {
  const m = new RegExp(`\\b${naam}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  return m ? ontEntiteit(m[2] ?? m[3] ?? '') : null
}

/**
 * De beschrijving van de subtaak als HTML voor in de mail. Alleen eenvoudige opmaak blijft over:
 * vet, cursief, lijstjes, citaten en links. Een vermelding van een collega of een andere taak
 * wordt gewone tekst: de ontvanger kan niet in Asana.
 */
export function beschrijvingAlsMailHtml(asanaHtml: string, thema: Thema = THEMAS.nbc): string {
  const uit: string[] = []
  const open: string[] = []
  // In een vermelding: de tekst blijft, de link niet.
  let inVermelding = 0

  const tekst = (ruw: string) => escapeHtml(ontEntiteit(ruw)).replace(/\r?\n/g, '<br>')

  for (const m of asanaHtml.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    if (m[4] !== undefined) {
      // Witruimte tussen de punten van een lijstje is opmaak van de bron, geen witregel.
      const binnenLijst = ['ul', 'ol'].includes(open[open.length - 1] ?? '')
      if (!(binnenLijst && !m[4].trim())) uit.push(tekst(m[4]))
      continue
    }
    const sluit = m[1] === '/'
    const tag = m[2].toLowerCase()
    const attrs = m[3] ?? ''

    if (tag === 'br') {
      uit.push('<br>')
    } else if (tag === 'hr') {
      uit.push('<hr style="border:0;border-top:1px solid #eaebec;margin:12px 0;">')
    } else if (tag === 'a') {
      if (sluit) {
        if (inVermelding) inVermelding--
        else if (open.includes('a')) {
          while (open.length) {
            const t = open.pop()!
            uit.push(`</${t}>`)
            if (t === 'a') break
          }
        }
        continue
      }
      // Een vermelding zonder tekst ("<a data-asana-gid="…"/>") heeft geen sluittag.
      if (/\/\s*$/.test(attrs)) continue
      const href = attribuut(attrs, 'href') ?? ''
      if (attribuut(attrs, 'data-asana-gid') || !/^(https?:|mailto:)/i.test(href)) {
        inVermelding++
        continue
      }
      open.push('a')
      uit.push(`<a href="${escapeHtml(href)}" style="color:${thema.link};">`)
    } else if (TOEGESTAAN[tag]) {
      const doel = TOEGESTAAN[tag]
      if (sluit) {
        // Alleen sluiten wat open staat; een losse sluittag mag de opmaak van de mail niet breken.
        const i = open.lastIndexOf(doel)
        if (i < 0) continue
        while (open.length > i) uit.push(`</${open.pop()}>`)
        if (tag === 'h1' || tag === 'h2') uit.push('<br>')
      } else {
        open.push(doel)
        uit.push(STIJL[doel] ? `<${doel} style="${STIJL[doel]}">` : `<${doel}>`)
      }
    }
    // Al het andere (body, img, onbekende tags) valt weg; de tekst erin blijft.
  }
  while (open.length) uit.push(`</${open.pop()}>`)
  return uit.join('')
    .replace(/<(strong|em|u|s|code)>\s*<\/\1>/g, '')
    .replace(/^(\s|<br>)+|(\s|<br>)+$/g, '')
}

/** De link achter de knop "Feedback geven": het formulier, met deze aanvraag al gekozen. */
export function feedbackUrl(aanvraagId: string, basis = FORMULIER_URL): string {
  const url = new URL(basis)
  url.searchParams.set('feedback', aanvraagId)
  return url.toString()
}

export interface OpleveringMail {
  aan: string[]
  /** Waar een antwoord op de mail heen gaat, zodat het niet in een postvak verdwijnt dat niemand leest. */
  antwoordAan: string[]
  aanvraagId: string
  versie: number
  /** Bepaalt de kleuren: NBC-teal of de olijftint van Green Village. */
  locatie: Locatie
  soort: Soort
  /** Leeg bij een interne aanvraag. */
  event: string
  eventDatum: string | null
  omschrijving: string
  types: RequestTypeKey[]
  andersTekst: string
  /** De beschrijving van de subtaak, al omgezet met beschrijvingAlsMailHtml (met hetzelfde thema). */
  berichtHtml: string
  /** Wie op de knop drukte; staat onder het bericht. */
  afzenderNaam: string | null
  bijlagen: { naam: string; bytes: number }[]
  links: { naam: string; url: string }[]
  /** De 3D-previews van de ledkolom; alleen bij een LED-kolom met een video in de subtaak. */
  previews?: PreviewInMail[]
  /** Een proefmail: alleen naar wie hem vroeg, met bovenaan wie de echte mail zou krijgen. */
  proef?: { echteOntvangers: string[] } | null
}

/** "EY - 11 december - Torenscherm", of bij intern "Intern - Nieuwe visitekaartjes…". */
function waarover(m: Pick<OpleveringMail, 'soort' | 'event' | 'eventDatum' | 'omschrijving' | 'types' | 'andersTekst'>): string {
  if (m.soort === 'intern') return ['Intern', kortVan(m.omschrijving)].filter(Boolean).join(' - ')
  return [m.event.trim(), m.eventDatum ? formatDateShortNl(m.eventDatum, false) : '', describeRequestTypes(m.types, m.andersTekst)]
    .filter(Boolean).join(' - ')
}

export function renderOpleveringMail(m: OpleveringMail): MailBericht {
  const intern = m.soort === 'intern'
  const nieuweVersie = m.versie > 1
  const thema = themaVoor(m.locatie)
  const delen: string[] = []

  if (m.proef) {
    delen.push(waarschuwingBlok(
      `<strong>Proefmail.</strong> Alleen jij krijgt deze. De echte mail gaat naar ${escapeHtml(opsomming(m.proef.echteOntvangers))}. `
        + 'De knop werkt echt: klik er niet op, anders komt er feedback bij de taak.',
    ))
  }
  delen.push(`<p style="margin:0 0 16px;">Hoi,</p>`)
  delen.push(`<p style="margin:0 0 16px;">${nieuweVersie
    ? `Versie ${m.versie} van ${intern ? 'je aanvraag' : `het design voor <strong>${escapeHtml(m.event)}</strong>`} staat klaar, met je feedback verwerkt.`
    : `${intern ? 'Je aanvraag' : `Het design voor <strong>${escapeHtml(m.event)}</strong>`} staat klaar.`}</p>`)

  if (m.berichtHtml) {
    delen.push(vlak(m.berichtHtml, { achtergrond: thema.tint, onder: 4 }))
    if (m.afzenderNaam) delen.push(`<p style="margin:0 0 16px;color:#596165;font-size:13px;">${escapeHtml(m.afzenderNaam)}, Marketing</p>`)
  }

  const previews = m.previews ?? []
  if (previews.length) {
    const meer = previews.length > 1
    delen.push(`<p style="margin:8px 0 0;font-weight:bold;">Bekijk ${meer ? 'de ledkolommen' : 'de ledkolom'} in 3D</p>`)
    delen.push(`<p style="margin:4px 0 0;">Draai de kolom rond, en zie hem op locatie: op de ledkolommen in de foyer van NBC. `
      + 'Werkt op je telefoon en op je computer, zonder inloggen.</p>')
    if (m.proef && previews.some((p) => !p.klaar)) {
      delen.push(`<p style="margin:4px 0 0;color:#596165;font-size:13px;">(Proef: de 3D-preview wordt nog gemaakt en staat over een paar minuten online. De echte mail gaat pas de deur uit als hij klaar is.)</p>`)
    }
    for (const p of previews) delen.push(knop(p.url, meer ? `Bekijk ${p.naam} in 3D` : 'Bekijk in 3D', thema))
    delen.push(ruimte('', 8))
  }

  const rijen: [string, string][] = []
  if (intern) rijen.push(['Aanvraag', escapeHtml(kortVan(m.omschrijving, 120) || 'Interne aanvraag')])
  else {
    rijen.push(['Event', escapeHtml(m.event)])
    if (m.eventDatum) rijen.push(['Eventdatum', escapeHtml(formatDateShortNl(m.eventDatum))])
    if (m.types.length) rijen.push(['Aanvraag', escapeHtml(describeRequestTypes(m.types, m.andersTekst))])
  }
  if (nieuweVersie) rijen.push(['Versie', String(m.versie)])
  if (m.bijlagen.length) {
    rijen.push(['Bijlagen', m.bijlagen.map((b) => `${escapeHtml(b.naam)} <span style="color:#828b8d;">(${escapeHtml(formatBytes(b.bytes))})</span>`).join('<br>')])
  }
  if (m.links.length) {
    rijen.push(['Bestanden', m.links.map((l) => `<a href="${escapeHtml(l.url)}" style="color:${thema.link};">${escapeHtml(l.naam)}</a>`).join('<br>')])
  }
  delen.push(ruimte(gegevensTabel(rijen), 16))

  delen.push(`<p style="margin:24px 0 0;font-weight:bold;">Iets aan te passen?</p>`)
  delen.push(`<p style="margin:4px 0 0;">Geef je feedback via de knop hieronder. Dan komt hij meteen bij de juiste aanvraag terecht, `
    + `en kun je er bestanden en een nieuwe deadline bij doen. Is alles goed, dan hoef je niets te doen.</p>`)
  delen.push(knop(feedbackUrl(m.aanvraagId), 'Feedback geven', thema))

  const kop = nieuweVersie ? `Versie ${m.versie} staat klaar` : 'Je design staat klaar'
  return {
    aan: m.aan,
    antwoordAan: m.antwoordAan,
    onderwerp: `${m.proef ? '[PROEF] ' : ''}${nieuweVersie ? `Versie ${m.versie} klaar` : 'Klaar'}: ${waarover(m)}`.slice(0, 250),
    html: mailOpmaak(kop, delen.join('\n'), 'Verstuurd door het marketingteam via het designaanvraag-formulier.', thema),
  }
}

function escapeAsana(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function asanaLink(p: { naam: string; url: string }): string {
  return `<a href="${escapeAsana(p.url)}">${escapeAsana(p.naam)}</a>`
}

function opsomming(woorden: string[]): string {
  if (woorden.length <= 1) return woorden.join('')
  return `${woorden.slice(0, -1).join(', ')} en ${woorden[woorden.length - 1]}`
}

/** De reactie in Asana na een proefmail: waar hij heen ging en wie de echte krijgt. */
export function verslagProef(v: { naar: string; aan: string[]; bijlagen: string[]; links: string[]; previews?: PreviewInMail[] }): string {
  const previews = v.previews ?? []
  const delen = [`Proefmail gestuurd naar ${escapeAsana(v.naar)}. De echte mail gaat naar ${escapeAsana(opsomming(v.aan))}`]
  delen[0] += v.bijlagen.length ? `, met ${escapeAsana(opsomming(v.bijlagen))}.` : v.links.length || previews.length ? '.' : ', zonder bijlagen.'
  if (v.links.length) delen.push(`Als link: ${escapeAsana(v.links.join(', '))}.`)
  if (previews.length) {
    delen.push(`3D-preview: ${previews.map(asanaLink).join(', ')}.`)
    if (previews.some((p) => !p.klaar)) delen.push('Die wordt nog gemaakt; de echte mail wacht daar vanzelf op.')
  }
  delen.push('Klopt alles, zet Oplevermail dan op Verstuur nu.')
  return `<body>${delen.join(' ')}</body>`
}

/** De reactie in Asana na een geslaagde mail: wie, wat en welke versie. */
export function verslagVerstuurd(v: { versie: number; aan: string[]; bijlagen: string[]; links: string[]; datum: string; previews?: { naam: string; url: string }[] }): string {
  const previews = v.previews ?? []
  const delen = [`Opleveringsmail${v.versie > 1 ? ` (versie ${v.versie})` : ''} verstuurd op ${escapeAsana(formatDateShortNl(v.datum))} aan ${escapeAsana(opsomming(v.aan))}.`]
  if (v.bijlagen.length) delen.push(`Bijlagen: ${escapeAsana(v.bijlagen.join(', '))}.`)
  if (v.links.length) delen.push(`Als link: ${escapeAsana(v.links.join(', '))}.`)
  if (previews.length) delen.push(`3D-preview: ${previews.map(asanaLink).join(', ')}.`)
  if (!v.bijlagen.length && !v.links.length && !previews.length) delen.push('Zonder bijlagen.')
  return `<body>${delen.join(' ')}</body>`
}

/**
 * De reactie in Asana als er niets verstuurd is. Met een vermelding, zodat het in je Asana-inbox
 * landt; je zit misschien al op de volgende taak te wachten tot hij verstuurd is.
 */
export function verslagMislukt(reden: string, vermeldGid: string | null, proef = false): string {
  const vermelding = vermeldGid ? `<a data-asana-gid="${escapeAsana(vermeldGid)}"/> ` : ''
  return `<body>${vermelding}De ${proef ? 'proefmail' : 'opleveringsmail'} is <strong>niet</strong> verstuurd. ${escapeAsana(reden)} `
    + 'Zet Oplevermail daarna opnieuw op Verstuur nu (of eerst op Stuur proef naar mij).</body>'
}
