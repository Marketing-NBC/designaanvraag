import { z } from 'zod'

/**
 * De huisstijl-brief die de Routine-sessie schrijft (worker/out/<id>/brand-brief.json).
 * Gevalideerd door worker/validate.mjs en opgeslagen in aanvragen.brand_result.
 */

export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Kleur moet een hex-code zijn zoals #1a2b3c')
  .transform((s) => s.toLowerCase())

export const fontSchema = z.object({
  /** Familienaam zoals gebruikt op de site, bv. "Montserrat". */
  family: z.string().trim().min(1).max(80),
  /** Gewicht(en) die op de site gebruikt worden, bv. "700" of "400/600". */
  weight: z.string().trim().max(40).default(''),
  source: z.enum(['google', 'adobe', 'custom', 'system', 'unknown']),
  /** Alternatief als de font niet beschikbaar is, bv. "Arial". */
  fallback: z.string().trim().max(80).default(''),
})

export const brandBriefSchema = z.object({
  brand_name: z.string().trim().min(1).max(120),
  logo: z.object({
    /** Index in signals.logos (0-based) van het beste logo, of null als er geen bruikbaar logo is. */
    candidate_index: z.number().int().min(0).nullable(),
    reason: z.string().trim().max(500).default(''),
    /** Het logo is licht/wit en heeft een donkere achtergrond nodig. */
    prefers_dark_bg: z.boolean().default(false),
  }),
  colors: z
    .array(
      z.object({
        hex: hexColor,
        role: z.enum(['primary', 'secondary', 'accent', 'background', 'text', 'other']),
        /** Korte naam in het Nederlands, bv. "marineblauw". */
        name: z.string().trim().max(60).default(''),
        /** Waar de kleur vandaan komt, bv. "CTA-knop", "logo", "koppen". */
        source: z.string().trim().max(200).default(''),
      }),
    )
    .min(1)
    .max(10),
  fonts: z.object({ heading: fontSchema, body: fontSchema }),
  /** 3 tot 6 korte stijlnotities in het Nederlands voor de designer. */
  style_notes: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().trim().max(300)).max(10).default([]),
})

export type BrandBrief = z.output<typeof brandBriefSchema>
