/**
 * Waar het menu voor het menuscherm vandaan komt.
 *
 * De taakbeschrijving in Asana is leidend: daar corrigeert Marketing het menu, dus wat daar onder
 * "Menu" staat wordt gegenereerd. Is het daar niet veranderd, dan nemen we het menu zoals het in
 * het formulier is aangeklikt (menu_inhoud). Dat is hetzelfde menu, maar met de opbouw erbij die
 * in platte tekst verloren gaat, zoals de onderdelen van de Tartelettes bij Grab & Go.
 */
import { menuSleutel, menuUitBeschrijving } from '../../shared/menu-beschrijving.ts'

/**
 * @param {{ beschrijvingHtml: string | null, aanvraag: { menu_inhoud?: object | null, menu_tekst?: string | null } | null }} o
 * @returns {{ inhoud: object | null, tekst: string | null, notitie: string | null }}
 */
export function kiesMenuBron({ beschrijvingHtml, aanvraag }) {
  const uitFormulier = { inhoud: aanvraag?.menu_inhoud ?? null, tekst: aanvraag?.menu_tekst || null }
  const beschrijving = menuUitBeschrijving(beschrijvingHtml)

  if (!beschrijving) {
    const heeftMenu = Boolean(uitFormulier.inhoud || uitFormulier.tekst)
    return {
      ...uitFormulier,
      notitie: heeftMenu ? 'Er staat geen kopje "Menu" in de taakbeschrijving; het menu uit het formulier is gebruikt.' : null,
    }
  }
  if (uitFormulier.inhoud && menuSleutel(beschrijving) === menuSleutel(uitFormulier.tekst)) {
    return { ...uitFormulier, notitie: null }
  }
  return { inhoud: null, tekst: beschrijving, notitie: 'Het menu komt uit de taakbeschrijving, zoals het daar nu staat.' }
}

/** Een gerecht als één regel, zoals het formulier hem schrijft (web/src/lib/menu.ts, regelVan). */
function regelVan(g) {
  if (g.onderdelen) return [g.naam, ...g.onderdelen.map((o) => `• ${o.naam}`)].join(' ')
  return [g.naam, ...(g.ingredienten ?? [])].filter(Boolean).join(' | ')
}

const sleutel = (t) => String(t).toLowerCase().replace(/\s*\|\s*/g, ' | ').replace(/\s+/g, ' ').trim()

/**
 * Gerechten met onderdelen terugzetten na een rondje door platte tekst.
 *
 * In tekst staan de Tartelettes van Grab & Go op één regel: "Tartelettes • Rundertartaar •
 * Taleggio (vega)". Zo gelezen is dat één lange naam, en verdwijnen de onderdelen en hun
 * cursieve toelichting van het scherm. Staat die regel er precies zoals in de bibliotheek, dan
 * is er niets aan veranderd en nemen we het gerecht uit de bibliotheek, met zijn opbouw.
 * Een bewerkte regel laten we zoals hij is: dan heeft iemand bewust iets anders getypt.
 *
 * @param {Array<{ kop: string | null, gerechten: object[] }>} secties
 * @param {object[]} bibliotheek  de gerechten uit shared/menu-pakketten.json
 */
export function herstelOnderdelen(secties, bibliotheek) {
  const opRegel = new Map(bibliotheek.filter((g) => g.onderdelen).map((g) => [sleutel(regelVan(g)), g]))
  return secties.map((s) => ({
    ...s,
    gerechten: s.gerechten.map((g) => {
      if (g.onderdelen) return g
      const bekend = opRegel.get(sleutel(regelVan(g)))
      return bekend ? structuredClone(bekend) : g
    }),
  }))
}
