import { z } from 'zod'
import { isoDate, normalizeUrl } from './aanvraag-schema.ts'
import { bijlageIdsSchema } from './bijlagen.ts'
import { REQUEST_TYPE_KEYS, type RequestTypeKey, type Soort } from './request-types.ts'

/**
 * Aanvullingen op een aanvraag die al een Asana-taak heeft: extra wensen, aanvullende informatie of
 * feedback op het concept. Ze komen als comment onder de bestaande taak en werken een paar velden
 * bij, zodat er geen tweede taak voor hetzelfde event ontstaat.
 */

/** Minder letters geeft te veel treffers om nuttig te zijn, en nodigt uit tot rondneuzen. */
export const ZOEK_MIN_TEKENS = 3
export const ZOEK_MAX_RESULTATEN = 10
/** Ouder dan dit is het event allang geweest; die aanvragen horen niet meer in de zoeklijst. */
export const ZOEK_DAGEN = 120
/**
 * Een interne aanvraag heeft geen event om op te zoeken; die vind je terug op je eigen naam.
 * Een naam als "Bo" moet kunnen, dus hier is de grens lager dan bij het event.
 */
export const ZOEK_NAAM_MIN_TEKENS = 2
/** Zoveel van de omschrijving gaat mee in een treffer: genoeg om je eigen aanvraag te herkennen. */
export const ZOEK_OMSCHRIJVING_TEKENS = 140

/**
 * Eén treffer in de zoeklijst: genoeg om de juiste aanvraag te herkennen, niet meer. Bewust geen
 * verwijzing naar het werksysteem van Marketing — collega's werken daar niet in, en dit endpoint
 * staat open op internet.
 */
export interface GevondenAanvraag {
  id: string
  soort: Soort
  /** Leeg bij een interne aanvraag. */
  event: string
  /** Null bij een interne aanvraag. */
  event_datum: string | null
  /** Null bij een interne aanvraag zonder deadline. */
  deadline: string | null
  naam: string
  aanvraag_types: RequestTypeKey[]
  anders_tekst: string
  /** Al ingevuld? Dan laat het formulier zien dat een nieuw pad er alleen bij wordt gemeld. */
  schijf_locatie: string
  /**
   * Het begin van de omschrijving, ingekort tot ZOEK_OMSCHRIJVING_TEKENS. Alleen gevuld bij een
   * interne aanvraag: daar is het de enige manier om de ene van de andere te onderscheiden.
   */
  omschrijving: string
}

export const aanvullingSchema = z
  .object({
    aanvraag_id: z.uuid(),
    /** Wie de aanvulling stuurt; hoeft niet dezelfde collega te zijn als de oorspronkelijke aanvrager. */
    naam: z.string().trim().min(1, 'Kies je naam').max(80),
    toelichting: z.string().trim().min(5, 'Vertel kort wat er moet veranderen').max(3000, 'Maximaal 3000 tekens'),
    /** Types die erbij komen. Wat er al staat blijft staan; aanvullen kan nooit iets weghalen. */
    extra_types: z.array(z.enum(REQUEST_TYPE_KEYS)).default([]),
    anders_tekst: z.string().trim().max(200, 'Maximaal 200 tekens').default(''),
    /**
     * Alleen invullen als de datum echt verschuift; null betekent "laat staan". Is de deadline van
     * de aanvraag al voorbij, dan is een nieuwe verplicht; dat controleert de function, want die
     * kent de oude.
     */
    nieuwe_event_datum: isoDate.nullable().default(null),
    nieuwe_deadline: isoDate.nullable().default(null),
    schijf_locatie: z.string().trim().max(500, 'Maximaal 500 tekens').default(''),
    /** Losse link naar materiaal (WeTransfer, SharePoint). Komt alleen in de reactie te staan. */
    link: z
      .string()
      .trim()
      .default('')
      .transform((s, ctx) => {
        if (!s) return ''
        const n = normalizeUrl(s)
        if (!n) {
          ctx.addIssue({ code: 'custom', message: 'Vul een geldige link in, bijvoorbeeld wetransfer.com/...' })
          return z.NEVER
        }
        return n
      }),
  })
  .superRefine((a, ctx) => {
    if (a.extra_types.includes('anders') && !a.anders_tekst) {
      ctx.addIssue({ code: 'custom', path: ['anders_tekst'], message: 'Vul in wat je erbij wilt aanvragen' })
    }
    // Staan beide datums in deze aanvulling, dan kunnen we ze hier al tegen elkaar houden. Schuift er
    // maar één, dan kent alleen de function de andere kant; die controleert het daar nog een keer.
    if (a.nieuwe_event_datum && a.nieuwe_deadline && a.nieuwe_deadline > a.nieuwe_event_datum) {
      ctx.addIssue({ code: 'custom', path: ['nieuwe_deadline'], message: 'De deadline kan niet na het event liggen' })
    }
  })

export type AanvullingInput = z.input<typeof aanvullingSchema>
export type Aanvulling = z.output<typeof aanvullingSchema>

/** Wat de browser naar de edge function stuurt: de aanvulling plus anti-misbruik-velden. */
export const aanvullingPayloadSchema = z.object({
  aanvulling: aanvullingSchema,
  client_request_id: z.uuid(),
  started_at: z.iso.datetime(),
  /** Zie submitPayloadSchema: hoort op payload-niveau, niet in het object dat de database in gaat. */
  bijlage_ids: bijlageIdsSchema,
  /** Honeypot: mensen laten dit leeg. */
  website_confirm: z.string().max(0).optional(),
})

export type AanvullingPayload = z.input<typeof aanvullingPayloadSchema>

export interface AanvullingResult {
  aanvulling_id: string
  /** Namen van de velden die daadwerkelijk zijn bijgewerkt; leeg = alleen een reactie geplaatst. */
  bijgewerkt: string[]
}
