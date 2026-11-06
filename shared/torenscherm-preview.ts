/**
 * Het torenscherm in de opleveringsmail.
 *
 * Een torenscherm-design ging tot nu toe als losse bijlage mee, vaak als gif. Nu staat er in de mail
 * zelf een foto van het torenscherm bij de ingang van NBC, met het design erop in perspectief, zoals
 * gasten het zien als ze aankomen. Marketing doet niets anders: het design staat zoals altijd als
 * bijlage in de subtaak Oplevering, en gaat ook als bijlage mee.
 *
 * Het maken van de afbeelding zit in supabase/functions/_shared/torenscherm/. Hier staan alleen de
 * keuzes: bij welke aanvraag, en welke bijlagen.
 */
import type { Locatie, RequestTypeKey } from './request-types.ts'

/**
 * Van welke locaties we een foto van het torenscherm hebben, met de hoeken van het scherm erop
 * opgemeten (scripts/torenscherm-foto.ts). Bij een andere locatie gaat de mail zoals vroeger.
 */
export const TORENSCHERM_LOCATIES: readonly Locatie[] = ['nbc']

/** De maat van het scherm zelf, in pixels. Een design in een andere verhouding krijgt zwarte randen, net als op het echte scherm. */
export const TORENSCHERM_BREEDTE = 2112
export const TORENSCHERM_HOOGTE = 1152

/** Een design groter dan dit zetten we niet op de foto: dat past niet in de rekentijd van een function. */
export const TORENSCHERM_MAX_BYTES = 25 * 1024 * 1024

/** Bestanden die we kunnen lezen. Een mp4 of webp gaat gewoon als bijlage mee, zonder afbeelding. */
const BEELD = /\.(jpe?g|png|gif)$/i

/** Bij welke aanvragen er een afbeelding van het torenscherm in de mail komt. */
export function isTorenschermAanvraag(types: readonly RequestTypeKey[] | null | undefined, locatie: Locatie): boolean {
  return (types ?? []).includes('torenscherm') && TORENSCHERM_LOCATIES.includes(locatie)
}

/** Het deel van een bijlage dat we hier nodig hebben (AsanaBestand uit oplevering.ts past erin). */
interface Bijlage {
  naam: string
  host: string
  bytes: number | null
}

/**
 * Welke bijlagen van de subtaak Oplevering op het torenscherm komen.
 *
 * Gaat de aanvraag alleen over het torenscherm, dan elk beeld (jpg, png of gif) in de subtaak.
 * Zijn er meer designs gevraagd (ook een koffiescherm, een ledkolom, ...), dan alleen de beelden met
 * "toren" in de naam. Van een gif komt het eerste beeld op de foto.
 */
export function torenschermBestanden<B extends Bijlage>(bestanden: readonly B[], types: readonly RequestTypeKey[] | null | undefined): B[] {
  const alleenToren = (types ?? []).length > 0 && (types ?? []).every((t) => t === 'torenscherm')
  return bestanden.filter((b) => b.host === 'asana' && BEELD.test(b.naam.trim()) && (alleenToren || /toren/i.test(b.naam))
    && (b.bytes ?? 0) <= TORENSCHERM_MAX_BYTES)
}

/** De afbeelding in de mail: een bijlage die in de tekst staat, met deze Content-ID. */
export function torenschermCid(i: number): string {
  return `torenscherm-${i + 1}@designaanvraag`
}

/** De naam van die afbeelding, voor wie hem opslaat: "Torenscherm - EY_Welkom.jpg". */
export function torenschermBeeldNaam(bestandsnaam: string): string {
  return `Torenscherm - ${bestandsnaam.replace(/\.[a-z0-9]+$/i, '')}.jpg`
}
