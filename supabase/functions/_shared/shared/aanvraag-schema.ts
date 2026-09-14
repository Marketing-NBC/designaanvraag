import { z } from 'zod'
import { REQUEST_TYPE_KEYS } from './request-types.ts'

/** Werkdagen die Abel normaal nodig heeft; korter geeft een zachte waarschuwing, geen blokkade. */
export const MIN_LEAD_BUSINESS_DAYS = 5

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ongeldige datum')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Ongeldige datum')

/**
 * Maakt van losse invoer een geldige https-URL. Geeft null terug als het geen URL kan zijn.
 * "nbc.nl" → "https://nbc.nl", "www.event.nl/x" → "https://www.event.nl/x".
 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname
  // Vereist een echte hostname met TLD (geen "localhost", geen spaties, geen IP-adres nodig).
  if (!/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i.test(host)) return null
  return url.toString()
}

export const aanvraagSchema = z
  .object({
    naam: z.string().trim().min(1, 'Kies je naam').max(80),
    event: z.string().trim().min(2, 'Vul de naam van het event in').max(120, 'Maximaal 120 tekens'),
    event_datum: isoDate,
    deadline: isoDate,
    website: z
      .string()
      .trim()
      .transform((s, ctx) => {
        const n = normalizeUrl(s)
        if (!n) {
          ctx.addIssue({ code: 'custom', message: 'Vul een geldige website in, bijvoorbeeld www.event.nl' })
          return z.NEVER
        }
        return n
      }),
    schijf_locatie: z.string().trim().max(500, 'Maximaal 500 tekens').default(''),
    aanvraag_types: z.array(z.enum(REQUEST_TYPE_KEYS)).min(1, 'Kies minimaal één optie'),
    anders_tekst: z.string().trim().max(200, 'Maximaal 200 tekens').default(''),
    design_modus: z.enum(['custom', 'standaard'], { error: 'Maak een keuze' }),
    omschrijving: z.string().trim().max(3000, 'Maximaal 3000 tekens').default(''),
  })
  .superRefine((a, ctx) => {
    if (a.deadline > a.event_datum) {
      ctx.addIssue({ code: 'custom', path: ['deadline'], message: 'De deadline kan niet na het event liggen' })
    }
    if (a.aanvraag_types.includes('anders') && !a.anders_tekst) {
      ctx.addIssue({ code: 'custom', path: ['anders_tekst'], message: 'Vul in wat je wilt aanvragen' })
    }
  })

export type AanvraagInput = z.input<typeof aanvraagSchema>
export type Aanvraag = z.output<typeof aanvraagSchema>

/** Wat de browser naar de edge function stuurt: de aanvraag plus anti-misbruik-velden. */
export const submitPayloadSchema = z.object({
  aanvraag: aanvraagSchema,
  client_request_id: z.uuid(),
  started_at: z.iso.datetime(),
  /** Honeypot: mensen laten dit leeg. */
  website_confirm: z.string().max(0).optional(),
})

export type SubmitPayload = z.input<typeof submitPayloadSchema>

export interface SubmitResult {
  aanvraag_id: string
  asana_task_url: string | null
  brand_dispatched: boolean
}
