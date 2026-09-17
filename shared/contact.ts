/**
 * Waar een collega terechtkan als het formulier niet verder kan. Staat in foutmeldingen van de edge
 * functions, en wordt via scripts/sync-shared.mjs meegekopieerd. Dependency-vrij, net als spoed.ts.
 *
 * Eén plek, want het adres staat in meerdere meldingen: verandert het ooit, dan hoort het niet
 * ergens achter te blijven staan.
 */

/** Het postvak van het marketingteam. */
export const MARKETING_MAIL = 'marketing@nbcevents.nl'
