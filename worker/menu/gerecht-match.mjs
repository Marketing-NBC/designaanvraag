/**
 * Een aangeleverd gerecht terugvinden in de gerechtenbibliotheek.
 *
 * NBC werkt met een vast repertoire, maar de tekst komt binnen zoals de traiteur
 * hem opschrijft: andere bewoording, andere volgorde, soms een tikfout. Wij
 * willen het gerecht dan toch zetten zoals het in het basisontwerp staat.
 *
 * Zoeken op gelijkenis is daarvoor niet goed genoeg - dat is geprobeerd en het
 * is gevaarlijk. "tasteful gift zalmtartaar | mierikswortel | affilla cress"
 * lijkt voor 90% op de tonijnversie uit het ontwerp, en dan zou er tonijn op het
 * scherm komen terwijl de opdrachtgever zalm besteld heeft. Juist het wisselen
 * van een product is bij NBC de normale gang van zaken.
 *
 * Daarom geen gelijkenis maar dekking: **elk woord uit het basisontwerp moet ook
 * in de aangeleverde tekst staan.** Een tikfout mag, extra woorden mogen, een
 * andere volgorde mag - maar een woord dat ontbreekt betekent een ander gerecht,
 * en dan houden we onze handen ervan af.
 *
 * Dit bestand draait zowel in Node (de tests) als in de browser (de opmaak-engine
 * zet het via render.mjs in het sjabloon).
 */

/** Tekens die anders gezet worden maar hetzelfde betekenen. */
const VARIANTEN = [
  [/[‘’´`]/g, "'"],
  [/[“”]/g, '"'],
]

/**
 * Tekst vergelijkbaar maken om hem in de bibliotheek terug te vinden.
 * Moet gelijk blijven aan tekstsleutel() in basis-extract.py.
 */
export function tekstsleutel(t) {
  let s = String(t)
  for (const [van, naar] of VARIANTEN) s = s.replace(van, naar)
  return s.toLowerCase()
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .trim()
}

/**
 * De sleutel van een heel gerecht: naam en ingredienten samen. Waar de streep
 * staat telt niet mee. Moet gelijk blijven aan gerechtsleutel() in basis-extract.py.
 */
export function gerechtsleutel(t) {
  return tekstsleutel(t).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()
}

// Woorden die niets over het gerecht zeggen. Bewust een korte, letterlijke lijst
// en geen regel op woordlengte: "ui" en "ham" zijn wel degelijk ingredienten.
const STOPWOORDEN = new Set(['met', 'van', 'en', 'de', 'het', 'in', 'op', 'of', 'la'])

export function woorden(tekst) {
  return String(tekst).toLowerCase()
    .split(/[^a-z0-9à-ÿ']+/)
    .filter((w) => w && !STOPWOORDEN.has(w))
}

/**
 * Schelen deze twee woorden hoogstens een tikfout (een letter erbij, eraf of
 * anders)? Korte woorden krijgen die speling niet: "ui" en "ei" zijn geen
 * verschrijving van elkaar maar twee ingredienten.
 */
export function tikfout(a, b) {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    let anders = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++anders > 1) return false
    return anders === 1
  }
  const [kort, lang] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < lang.length; i++) {
    if (lang.slice(0, i) + lang.slice(i + 1) === kort) return true
  }
  return false
}

/**
 * Hoeveel woorden staan er extra in `getypt` bovenop alles wat `bron` noemt?
 * null betekent: er ontbreekt een woord uit bron, dus dit is een ander gerecht.
 */
export function overtollig(bron, getypt) {
  const over = woorden(getypt)
  for (const w of woorden(bron)) {
    const i = over.findIndex((g) => tikfout(w, g))
    if (i === -1) return null
    over.splice(i, 1)
  }
  return over.length
}

// Hoeveel woorden er extra mogen staan, als deel van het gerecht uit het ontwerp.
// Zonder die grens zou "Burrata | tomatenmix | truffelolie" blijven hangen aan het
// losse gerecht "Burrata": alle woorden daarvan staan er immers in.
const RUIS = 0.4

/**
 * Zoekt het gerecht uit de bibliotheek dat hier is ingetypt.
 *
 * @param {string} getypt  naam en ingredienten zoals aangeleverd
 * @param {object} gerechten  de laag `gerechten` uit gerechten.json
 * @param {number|string} grootte  het corps van de naam in dit pakket
 * @returns {{sleutel: string, gerecht: object}|null}
 */
export function zoekGerecht(getypt, gerechten, grootte) {
  const voorvoegsel = `${grootte}|`
  const sleutel = voorvoegsel + gerechtsleutel(getypt)
  if (gerechten[sleutel]) return { sleutel, gerecht: gerechten[sleutel], letterlijk: true }

  const treffers = []
  for (const [k, gerecht] of Object.entries(gerechten)) {
    if (!k.startsWith(voorvoegsel)) continue
    const bron = k.slice(voorvoegsel.length)
    const extra = overtollig(bron, getypt)
    if (extra === null || extra > woorden(bron).length * RUIS) continue
    treffers.push({ extra, sleutel: k, gerecht })
  }
  if (!treffers.length) return null
  treffers.sort((a, b) => a.extra - b.extra)
  // Twee gerechten die er even goed op passen: dan weten we het niet, en dan
  // raden we niet. Onze eigen afbreking is beter dan het verkeerde gerecht.
  if (treffers.length > 1 && treffers[0].extra === treffers[1].extra) return null
  return { sleutel: treffers[0].sleutel, gerecht: treffers[0].gerecht, letterlijk: false }
}
