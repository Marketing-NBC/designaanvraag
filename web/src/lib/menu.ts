/**
 * De culinaire invulling als keuze in plaats van als tekst.
 *
 * NBC werkt met vaste pakketten. De collega koos die eerst door de hele invulling
 * over te typen, en dat ging mis: de opmaak-engine verwacht een kopje per gang met
 * de gerechten eronder, en wie dat net anders plakt krijgt niets. Nu kiest hij het
 * pakket en ziet hij wat erin zit; alleen de wijzigingen typt hij nog.
 *
 * Wat hier staat is de rekenkant daarvan - welke gerechten er in het menu zitten en
 * hoe daar weer een nette invulling van gemaakt wordt. De gerechten komen uit
 * shared/menu-pakketten.json, afgeleid uit de bevroren basisontwerpen, dus wat de
 * aanvrager aanklikt staat gegarandeerd in dezelfde spelling als op het scherm.
 */
import data from '../../../shared/menu-pakketten.json'

export interface Gerecht {
  naam: string
  ingredienten?: string[]
  onderdelen?: { naam: string; toelichting?: string[] }[]
}

export interface Pakket {
  pakket: string
  naam: string
  titel: string
  secties: { kop: string | null; gerechten: Gerecht[] }[]
}

export const PAKKETTEN: Pakket[] = data.pakketten as Pakket[]
export const ALLE_GERECHTEN: Gerecht[] = data.gerechten as Gerecht[]

/** Het menu zoals de aanvrager het samenstelt. */
export interface MenuKeuze {
  pakket: string | null
  /** Per onderdeel de gerechten die erin zitten, als regel. Leeg = nog niet gekozen. */
  secties: { kop: string | null; gerechten: string[] }[]
}

export const leegMenu = (): MenuKeuze => ({ pakket: null, secties: [] })

/**
 * Een gerecht als één regel: naam en ingredienten met een streep ertussen. Dit is
 * wat de aanvrager ziet, wat we opslaan en wat de opmaak-engine terugzoekt, zodat
 * er onderweg niets kan verschuiven.
 */
export function regelVan(g: Gerecht): string {
  if (g.onderdelen) return [g.naam, ...g.onderdelen.map((o) => `• ${o.naam}`)].join(' ')
  return [g.naam, ...(g.ingredienten ?? [])].filter(Boolean).join(' | ')
}

export const pakketVan = (naam: string | null) =>
  PAKKETTEN.find((p) => p.pakket === naam) ?? null

/** Het menu zoals het pakket het levert: alles erin, nog niets gewijzigd. */
export function uitPakket(naam: string): MenuKeuze {
  const p = pakketVan(naam)
  if (!p) return { pakket: null, secties: [] }
  return {
    pakket: p.pakket,
    secties: p.secties.map((s) => ({ kop: s.kop, gerechten: s.gerechten.map(regelVan) })),
  }
}

/** Alle regels die we kennen; alles daarbuiten is door iemand zelf ingetypt. */
const BEKEND = new Set(ALLE_GERECHTEN.map(regelVan))

export const isBekend = (regel: string) => BEKEND.has(regel)

/** De zelf getypte gerechten, in de volgorde waarin ze op het scherm komen. */
export function eigenGerechten(menu: MenuKeuze): string[] {
  return menu.secties.flatMap((s) => s.gerechten).filter((r) => !isBekend(r))
}

export const aantalGerechten = (menu: MenuKeuze) =>
  menu.secties.reduce((n, s) => n + s.gerechten.length, 0)

/**
 * Wat er van het pakket is afgeweken, in gewone taal. Marketing leest dit terug in
 * Asana, dus het moet te begrijpen zijn zonder het pakket ernaast te leggen.
 */
export function wijzigingen(menu: MenuKeuze): string[] {
  const basis = menu.pakket ? uitPakket(menu.pakket) : null
  if (!basis) return []
  const uit: string[] = []
  for (const [i, sectie] of menu.secties.entries()) {
    const was = basis.secties[i]?.gerechten ?? []
    const kop = sectie.kop ? `${sectie.kop}: ` : ''
    for (const r of was) if (!sectie.gerechten.includes(r)) uit.push(`${kop}${r} gaat eruit`)
    for (const r of sectie.gerechten) {
      if (was.includes(r)) continue
      uit.push(`${kop}${r} komt erbij${isBekend(r) ? '' : ' (staat niet in de gerechtenlijst)'}`)
    }
  }
  return uit
}

/**
 * De invulling zoals de opmaak-engine hem leest: een kopje per onderdeel, daaronder
 * de gerechten met een bolletje. Die vorm is precies waar het eerder op stukliep, en
 * daarom maken we hem hier en laten we hem niemand meer intypen.
 */
export function naarTekst(menu: MenuKeuze): string {
  const delen: string[] = []
  for (const s of menu.secties) {
    if (!s.gerechten.length) continue
    if (s.kop) delen.push(s.kop)
    for (const r of s.gerechten) delen.push(`• ${r}`)
    delen.push('')
  }
  return delen.join('\n').trim()
}

/** Het gerecht achter een regel, of null als niemand het kent. */
const PER_REGEL = new Map(ALLE_GERECHTEN.map((g) => [regelVan(g), g]))

/**
 * Het menu als structuur, zoals de opmaak-engine het het liefst krijgt.
 *
 * Tekst is goed genoeg voor acht van de negen pakketten, maar niet voor Grab & Go:
 * de Tartelettes zijn daar een kopje met gerechten eronder, en dat overleeft een
 * rondje door platte tekst niet - de bolletjes en de cursieve toelichting gaan
 * verloren. Daarom sturen we wat de aanvrager aanklikte en laten we de engine
 * niets meer terugparseren.
 */
export function naarInhoud(menu: MenuKeuze) {
  if (!menu.pakket) return null
  return {
    pakket: menu.pakket,
    secties: menu.secties
      .filter((s) => s.gerechten.length)
      .map((s) => ({
        kop: s.kop,
        gerechten: s.gerechten.map((regel) => {
          const bekend = PER_REGEL.get(regel)
          if (bekend) return bekend
          // Zelf ingetypt: de naam is alles tot de eerste streep, de rest zijn
          // ingredienten. Zo leest de engine losse tekst ook.
          const [naam, ...rest] = regel.split('|').map((d) => d.trim())
          return rest.length ? { naam, ingredienten: rest } : { naam }
        }),
      })),
  }
}
