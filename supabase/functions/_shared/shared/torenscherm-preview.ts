/**
 * De preview van het torenscherm, bij het opleveren.
 *
 * Een torenscherm-design ging tot nu toe als bijlage (vaak een gif) mee in de opleveringsmail. Nu
 * krijgt de aanvrager een knop naar een pagina waar het design op de foto van het torenscherm bij
 * de ingang van NBC staat, in perspectief, zoals het er op de dag zelf uitziet.
 *
 * Zo gaat het: Marketing zet het design (jpg, png, gif of mp4) zoals altijd als bijlage bij de
 * subtaak Oplevering. De webhook zet dat bestand in een openbare opslagbak, op een pad met een
 * onraadbare sleutel, met een klein meta.json ernaast. De pagina `torenscherm/` van het formulier
 * leest die twee en zet het design op de foto. Het bestand gaat dan niet meer als bijlage mee; op
 * de pagina staat een knop om het te downloaden.
 *
 * Puur: gegevens erin, keuzes en tekst eruit. Ophalen, opslaan en versturen doet de webhook.
 */
import { FORMULIER_URL } from './contact.ts'
import type { PreviewLink } from './ledkolom-preview.ts'
import type { Locatie, RequestTypeKey } from './request-types.ts'

/** De openbare opslagbak met de designs. Openbaar lezen, maar niet op te sommen: de sleutel is het slot. */
export const TORENSCHERM_BUCKET = 'torenscherm-previews'

/**
 * Groter gaat de opslagbak niet in (de grens van Supabase). Een torenscherm-mp4 van een minuut is
 * in de praktijk 10 à 30 MB.
 */
export const TORENSCHERM_MAX_BYTES = 50 * 1024 * 1024

/**
 * Van welke locaties we een foto van het torenscherm hebben, met de hoeken van het scherm erop
 * opgemeten (web/src/torenscherm/locaties.ts). Bij een andere locatie gaat het design gewoon als
 * bijlage mee, zoals vroeger.
 */
export const TORENSCHERM_LOCATIES: readonly Locatie[] = ['nbc']

/** De maat van het scherm zelf, in pixels. Een design in een andere verhouding krijgt zwarte randen, net als op het echte scherm. */
export const TORENSCHERM_BREEDTE = 2112
export const TORENSCHERM_HOOGTE = 1152

/** Welke bestanden op het scherm kunnen, met het type waarmee de browser ze moet openen. */
const MEDIA: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

/** Het type van een bestand dat op het scherm kan, of null (een pdf, een zip, ...). */
export function mediaType(naam: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(naam.trim())?.[1]?.toLowerCase() ?? ''
  return MEDIA[ext] ?? null
}

/** Bij welke aanvragen een design een torenscherm-preview wordt. */
export function isTorenschermAanvraag(types: readonly RequestTypeKey[] | null | undefined, locatie: Locatie): boolean {
  return (types ?? []).includes('torenscherm') && TORENSCHERM_LOCATIES.includes(locatie)
}

/** Het deel van een bijlage dat we hier nodig hebben (AsanaBestand uit oplevering.ts past erin). */
interface Bijlage {
  naam: string
  host: string
}

/**
 * Welke bijlagen van de subtaak Oplevering het torenscherm zijn.
 *
 * Gaat de aanvraag alleen over het torenscherm, dan is elk beeld en elke video in de subtaak het
 * torenscherm. Zijn er meer designs gevraagd (ook een ledkolom, een koffiescherm, ...), dan alleen
 * de bestanden met "toren" in de naam; de rest gaat als bijlage mee zoals altijd.
 */
export function torenschermBestanden<B extends Bijlage>(bestanden: readonly B[], types: readonly RequestTypeKey[] | null | undefined): B[] {
  const alleenToren = (types ?? []).length > 0 && (types ?? []).every((t) => t === 'torenscherm')
  return bestanden.filter((b) => b.host === 'asana' && mediaType(b.naam) && (alleenToren || /toren/i.test(b.naam)))
}

/** Hoe een design op de knop en de pagina heet: de bestandsnaam zonder extensie en zonder liggende streepjes. */
export function previewNaam(bestandsnaam: string): string {
  const naam = bestandsnaam.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return naam || 'Torenscherm'
}

/** 24 hextekens: niet te raden, en kort genoeg voor een nette link. */
export const SLEUTEL = /^[0-9a-f]{24}$/

export function nieuweSleutel(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Waar het design in de opslagbak staat: altijd dezelfde naam, alleen de extensie verschilt. */
export function ontwerpPad(sleutel: string, bestandsnaam: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(bestandsnaam.trim())?.[1]?.toLowerCase() ?? 'bin'
  return `${sleutel}/ontwerp.${ext}`
}

export function metaPad(sleutel: string): string {
  return `${sleutel}/meta.json`
}

/** Wat de pagina over een preview weet. Staat als meta.json naast het design. */
export interface TorenschermMeta {
  /** Bestandsnaam van het design in de opslagbak, naast meta.json: "ontwerp.mp4". */
  bestand: string
  mime: string
  /** De naam zoals Marketing het bestand noemde; voor de download. */
  origineel: string
  naam: string
  locatie: Locatie
  /** Leeg bij een interne aanvraag. */
  event: string
  eventDatum: string | null
}

/** De link achter de knop in de mail. */
export function torenschermUrl(sleutel: string, basis = FORMULIER_URL): string {
  return `${basis.replace(/\/?$/, '/')}torenscherm/?p=${sleutel}`
}

export function torenschermLink(naam: string, sleutel: string, basis = FORMULIER_URL): PreviewLink {
  return { naam, url: torenschermUrl(sleutel, basis) }
}

/** De reden in "Mislukt" als een design te groot is voor de opslagbak. */
export function teGrootVoorPreview(naam: string, bytes: number, max = TORENSCHERM_MAX_BYTES): string | null {
  if (bytes <= max) return null
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`
  return `${naam} is ${mb(bytes)}, en de torenscherm-preview kan hooguit ${mb(max)} aan. Maak een kleinere export (een mp4 van een minuut hoort ruim onder de 30 MB te blijven) en zet die in de subtaak Oplevering.`
}
