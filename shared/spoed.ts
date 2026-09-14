/**
 * Spoedaanvragen: alles wat minder dan 10 werkdagen vóór het event wordt aangevraagd.
 * Gedeeld door de edge function (via scripts/sync-shared.mjs) en beschikbaar voor de frontend.
 * Dependency-vrij, net als asana-title.ts, zodat Deno hem zonder npm-pakketten kan laden.
 *
 * De waarde wordt één keer bij het indienen bepaald en daarna niet meer aangepast: verschuift de
 * eventdatum later, dan blijft de registratie staan zoals het bij de aanvraag was.
 */

/** Minder dan dit aantal werkdagen tot het event = spoed. */
export const SPOED_WERKDAGEN = 10

/** Dagen sinds 1970-01-01 voor een ISO-datum (YYYY-MM-DD), tijdzone-vrij. */
function dagNummer(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000
}

/** Aantal werkdagen (ma–vr) tot en met dag `n`, met 1970-01-01 (een donderdag) als nulpunt. */
function werkdagenTotEnMet(n: number): number {
  const x = n + 3 // 0 = maandag
  return 5 * Math.floor(x / 7) + Math.min((x % 7) + 1, 5) - 3
}

/**
 * Werkdagen tussen twee ISO-datums: **startdag telt mee, einddag niet** — oftewel hoeveel werkdagen
 * je nog hebt vóór `totIso`. Negatief als `totIso` eerder ligt. Dit is precies de telwijze van
 * date-fns `differenceInBusinessDays`, die het formulier gebruikt voor de deadline-waarschuwing;
 * spoed.test.ts controleert dat over een heel jaar, zodat de twee niet uiteen kunnen lopen.
 */
export function werkdagenTussen(vanIso: string, totIso: string): number {
  const van = dagNummer(vanIso)
  const tot = dagNummer(totIso)
  if (!Number.isFinite(van) || !Number.isFinite(tot)) return NaN
  return werkdagenTotEnMet(tot - 1) - werkdagenTotEnMet(van - 1)
}

/** Vandaag als ISO-datum in Nederlandse tijd; de edge function draait in UTC. */
export function vandaagInNl(now: Date = new Date()): string {
  // 'sv-SE' formatteert als YYYY-MM-DD.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(now)
}

/** Werkdagen tussen de aanvraag en het event. */
export function werkdagenTotEvent(eventDatum: string, vandaagIso: string = vandaagInNl()): number {
  return werkdagenTussen(vandaagIso, eventDatum)
}

/** Spoedje: minder dan SPOED_WERKDAGEN werkdagen tot het event (een event van vandaag telt ook). */
export function isSpoed(eventDatum: string, vandaagIso: string = vandaagInNl()): boolean {
  const n = werkdagenTotEvent(eventDatum, vandaagIso)
  return Number.isFinite(n) && n < SPOED_WERKDAGEN
}
