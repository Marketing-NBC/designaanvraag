/**
 * Het gifje bovenaan elke mail. Per soort mail een eigen rijtje; elke mail kiest er willekeurig één.
 *
 * De gifjes zitten niet in de mail zelf maar staan op GitHub Pages, naast het formulier
 * (web/public/mail-gifs/). In de mail staat alleen een verwijzing. Zo blijft de mail even klein als
 * zonder gifje, gaat er niets af van de ruimte voor bijlagen in de opleveringsmail, en kost het
 * niets: Pages is gratis en Supabase merkt er niets van.
 *
 * Een gifje toevoegen: zet het bestand in web/public/mail-gifs/, liefst rond de 480 px breed en
 * onder de 500 KB, en zet het hieronder bij de juiste mail met de echte breedte en hoogte. De
 * klassieke Outlook op Windows laat alleen het eerste beeldje zien: kies er een waarvan dat ook
 * los werkt. Een gifje staat pas online na de deploy naar Pages (een push naar main die web/ raakt).
 *
 * Is een rijtje leeg, dan krijgt die mail geen gifje. Dependency-vrij, zodat Deno en Node hem allebei
 * zonder pakketten laden.
 */
import { FORMULIER_URL } from './contact.ts'

export type GifMail =
  | 'bevestiging'
  | 'oplevering'
  | 'herinnering'
  | 'nieuwe_aanvraag'
  | 'aanvulling'
  | 'akkoord'
  | 'weekmail'

export interface GifBestand {
  /** De bestandsnaam in web/public/mail-gifs/. */
  bestand: string
  breedte: number
  hoogte: number
  /** Staat er als het plaatje niet laadt, en wordt voorgelezen. */
  alt: string
}

/** Een gekozen gifje, klaar voor de mail. */
export interface MailGif {
  url: string
  breedte: number
  hoogte: number
  alt: string
}

/** Waar de gifjes online staan: de map mail-gifs naast het formulier. */
export const MAIL_GIF_BASIS = `${FORMULIER_URL}mail-gifs/`

/**
 * Breder wordt een gifje in de mail niet: de inhoud van de mail is 552 px (600 min de marge), en
 * een uitvergroot gifje wordt wazig.
 */
export const MAX_GIF_BREEDTE = 480

export const MAIL_GIFS: Record<GifMail, GifBestand[]> = {
  // Eerst één gifje, om te testen hoe het overkomt. De rest volgt na de keuze uit het voorstel.
  bevestiging: [
    { bestand: 'im-on-it.gif', breedte: 480, hoogte: 287, alt: "I'm on it!" },
  ],
  oplevering: [],
  herinnering: [],
  nieuwe_aanvraag: [],
  aanvulling: [],
  akkoord: [],
  weekmail: [],
}

/**
 * Een willekeurig gifje voor deze mail, of null als er (nog) geen zijn. `basis` is anders bij een
 * testmail van een branch, waar de gifjes nog niet op Pages staan.
 */
export function kiesGif(mail: GifMail, basis = MAIL_GIF_BASIS, kans: () => number = Math.random): MailGif | null {
  const rij = MAIL_GIFS[mail]
  if (!rij.length) return null
  const g = rij[Math.min(rij.length - 1, Math.floor(kans() * rij.length))]
  return { url: new URL(g.bestand, basis).toString(), breedte: g.breedte, hoogte: g.hoogte, alt: g.alt }
}

/**
 * Het gifje uit de opties van een render-functie: `undefined` is zelf kiezen, `null` is geen gifje
 * (zoals in de tests), en een gifje is dat gifje (zoals in de testmail).
 */
export function gifVoor(mail: GifMail, gekozen: MailGif | null | undefined): MailGif | null {
  return gekozen === undefined ? kiesGif(mail) : gekozen
}
