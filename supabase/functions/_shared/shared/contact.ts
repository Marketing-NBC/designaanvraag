/**
 * Waar een collega terechtkan als het formulier niet verder kan. Staat in foutmeldingen van de edge
 * functions, en wordt via scripts/sync-shared.mjs meegekopieerd. Dependency-vrij, net als spoed.ts.
 *
 * Eén plek, want het adres staat in meerdere meldingen: verandert het ooit, dan hoort het niet
 * ergens achter te blijven staan.
 */

/** Het postvak van het marketingteam. */
export const MARKETING_MAIL = 'marketing@nbcevents.nl'

/**
 * Waar de meldingen naartoe gaan: een nieuwe aanvraag, een aanvulling en het weekoverzicht. Per
 * locatie, want Green Village heeft een eigen marketingpostvak. Deze adressen staan toch al op
 * de websites, dus ze mogen in deze publieke repo.
 */
export const MELDING_ONTVANGERS = {
  nbc: MARKETING_MAIL,
  green_village: 'marketing@green-village.nl',
} as const

/**
 * Het postvak waar de meldingen vandaan komen. Aan de afzender zie je meteen dat het om een
 * designaanvraag gaat. Het moet een echte (gedeelde) mailbox in Microsoft 365 zijn: zie het kopje
 * "Mail instellen" in de README.
 */
export const MELDING_AFZENDER = 'designaanvraag@nbcevents.nl'
