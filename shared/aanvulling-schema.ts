import { z } from 'zod'
import { isoDate, normalizeUrl } from './aanvraag-schema.ts'
import { REQUEST_TYPE_KEYS, type RequestTypeKey } from './request-types.ts'

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
 * Eén treffer in de zoeklijst: genoeg om de juiste aanvraag te herkennen, niet meer. Bewust geen
 * verwijzing naar het werksysteem van Marketing — collega's werken daar niet in, en dit endpoint
 * staat open op internet.
 */
export interface GevondenAanvraag {
  id: string
  event: string
  event_datum: string
  deadline: string
  naam: string
  aanvraag_types: RequestTypeKey[]
  anders_tekst: string
  /** Al ingevuld? Dan laat het formulier zien dat een nieuw pad er alleen bij wordt gemeld. */
  schijf_locatie: string
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
    /** Alleen invullen als de datum echt verschuift; null betekent "laat staan". */
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
  /** Honeypot: mensen laten dit leeg. */
  website_confirm: z.string().max(0).optional(),
})

export type AanvullingPayload = z.input<typeof aanvullingPayloadSchema>

export interface AanvullingResult {
  aanvulling_id: string
  /** Namen van de velden die daadwerkelijk zijn bijgewerkt; leeg = alleen een reactie geplaatst. */
  bijgewerkt: string[]
}
