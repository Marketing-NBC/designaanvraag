/**
 * Het gifje bovenaan elke mail. Per soort mail is er een map in web/public/mail-gifs/ (bevestiging,
 * oplevering, …); elke mail kiest willekeurig een gifje uit zijn map. Een gifje toevoegen is het
 * bestand in de juiste map zetten, meer niet: zie web/public/mail-gifs/README.md.
 *
 * De gifjes zitten niet in de mail zelf maar staan op GitHub Pages, naast het formulier. In de mail
 * staat alleen een verwijzing. Zo blijft de mail even klein als zonder gifje, gaat er niets af van
 * de ruimte voor bijlagen in de opleveringsmail, en kost het niets: Pages is gratis.
 *
 * Hoe de mail weet welke gifjes er zijn: bij de deploy naar Pages maakt scripts/mail-gifs.mjs een
 * lijst (gifs.json) van wat er in de mappen staat, en maakt te grote gifjes kleiner. Bij het
 * versturen haalt de mail die lijst op (zie createGraphMail in mail.ts). Lukt dat niet, dan gaat
 * de mail gewoon zonder gifje.
 *
 * Dependency-vrij, zodat Deno en Node hem allebei zonder pakketten laden.
 */
import { FORMULIER_URL } from './contact.ts'

/** De mappen in web/public/mail-gifs/, één per soort mail. */
export const GIF_MAPPEN = [
  'bevestiging',
  'oplevering',
  'herinnering',
  'nieuwe-aanvraag',
  'aanvulling',
  'akkoord',
  'weekoverzicht',
] as const
export type GifMap = typeof GIF_MAPPEN[number]

/** Eén gifje in de lijst: het pad vanaf de map mail-gifs, en de maat. */
export interface GifInfo {
  bestand: string
  breedte: number
  hoogte: number
}

/** De lijst die bij de deploy wordt gemaakt: per map de gifjes die erin staan. */
export type GifLijst = Partial<Record<GifMap, GifInfo[]>>

/** Een gekozen gifje, klaar voor de mail. */
export interface MailGif {
  url: string
  breedte: number
  hoogte: number
  alt: string
}

/** Waar de gifjes online staan: de map mail-gifs naast het formulier. */
export const MAIL_GIF_BASIS = `${FORMULIER_URL}mail-gifs/`
/** De naam van de lijst, in de map mail-gifs. */
export const GIF_LIJST = 'gifs.json'

/**
 * Breder of hoger wordt een gifje in de mail niet. De inhoud van de mail is 552 px breed, en een
 * uitvergroot gifje wordt wazig; hoger dan dit duwt de tekst te ver naar beneden.
 */
export const MAX_GIF_BREEDTE = 480
export const MAX_GIF_HOOGTE = 360

/** "akkoord/Yes-baby_2.gif" wordt "Yes baby 2": staat er als het plaatje niet laadt. */
export function altVan(bestand: string): string {
  const naam = bestand.split('/').pop() ?? ''
  return naam.replace(/\.gif$/i, '').replace(/[-_]+/g, ' ').trim()
}

/** De maat in de mail: past binnen MAX_GIF_BREEDTE × MAX_GIF_HOOGTE, met dezelfde verhouding. */
export function maatInMail(breedte: number, hoogte: number): { breedte: number; hoogte: number } {
  const schaal = Math.min(1, MAX_GIF_BREEDTE / breedte, MAX_GIF_HOOGTE / hoogte)
  return { breedte: Math.round(breedte * schaal), hoogte: Math.round(hoogte * schaal) }
}

/** Een willekeurig gifje uit de map van deze mail, of null als die map leeg is. */
export function kiesGif(lijst: GifLijst | null, map: GifMap, basis = MAIL_GIF_BASIS, kans: () => number = Math.random): MailGif | null {
  const rij = (lijst?.[map] ?? []).filter((g) => g.bestand && g.breedte > 0 && g.hoogte > 0)
  if (!rij.length) return null
  const g = rij[Math.min(rij.length - 1, Math.floor(kans() * rij.length))]
  // Een naam met spaties of andere tekens moet in een adres gecodeerd; de schuine strepen niet.
  const pad = g.bestand.split('/').map(encodeURIComponent).join('/')
  return { url: new URL(pad, basis).toString(), breedte: g.breedte, hoogte: g.hoogte, alt: altVan(g.bestand) }
}

/** Is dit een map uit GIF_MAPPEN? */
export function isGifMap(s: string): s is GifMap {
  return (GIF_MAPPEN as readonly string[]).includes(s)
}

type Fetch = typeof fetch

/**
 * Haalt de lijst van Pages, en onthoudt hem tien minuten: een function die warm blijft hoeft hem
 * dan niet bij elke mail opnieuw op te halen. Gooit nooit: bij een fout is het null, en gaat de
 * mail zonder gifje.
 */
export function gifLijstVan(basis = MAIL_GIF_BASIS, doFetch: Fetch = fetch, bewaarMs = 10 * 60_000): () => Promise<GifLijst | null> {
  let bewaard: { lijst: GifLijst; tot: number } | null = null
  return async () => {
    if (bewaard && bewaard.tot > Date.now()) return bewaard.lijst
    try {
      const res = await doFetch(new URL(GIF_LIJST, basis).toString(), { signal: AbortSignal.timeout(3_000) })
      if (!res.ok) return null
      const lijst = (await res.json()) as GifLijst
      if (!lijst || typeof lijst !== 'object') return null
      bewaard = { lijst, tot: Date.now() + bewaarMs }
      return lijst
    } catch {
      return null
    }
  }
}
