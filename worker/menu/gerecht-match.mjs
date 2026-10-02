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
  // Dezelfde normalisatie als tekstsleutel, anders valt een gerecht uit elkaar waar
  // het in de bibliotheek aan elkaar staat: "Tony's" met een krulapostrof werd
  // "tony" + "s" en vond de sleutel "tony's" niet meer. Word en Outlook zetten dat
  // krulletje vanzelf, dus dat overkomt iedereen die iets inplakt.
  let t = String(tekst)
  for (const [van, naar] of VARIANTEN) t = t.replace(van, naar)
  return t.toLowerCase()
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
/**
 * Hetzelfde woord, aan de ene kant aan elkaar en aan de andere kant los. De
 * ontwerper zet "miso boter jus" waar de bibliotheek "misoboterjus" schrijft, en
 * "Volkoren punt" tegenover "Volkorenpunt". Dat is dezelfde schotel, dus dat mag
 * samenvallen - maar alleen als de woorden naast elkaar staan en in dezelfde
 * volgorde, anders zou "kroket oesterzwam" ineens "oesterzwamkroket" zijn.
 *
 * Korte woorden doen niet mee, om dezelfde reden als bij tikfout(): "u i" is geen
 * manier om "ui" te schrijven, en zo zou elk kort ingredient overal in passen.
 *
 * Geeft terug hoeveel woorden er vanaf `vanaf` zijn opgegaan in `doel`, of 0.
 */
function samenvoeging(lijst, vanaf, doel) {
  if (doel.length < 5) return 0
  let samen = ''
  for (let n = 0; n < 3 && vanaf + n < lijst.length; n++) {
    samen += lijst[vanaf + n]
    if (samen.length > doel.length + 1) break
    if (n > 0 && tikfout(doel, samen)) return n + 1
  }
  return 0
}

export function overtollig(bron, getypt) {
  const over = woorden(getypt)
  const bronwoorden = woorden(bron)
  for (let b = 0; b < bronwoorden.length; b++) {
    const w = bronwoorden[b]
    const los = over.findIndex((g) => tikfout(w, g))
    if (los !== -1) {
      over.splice(los, 1)
      continue
    }
    // Niet als los woord gevonden: staat het er misschien als twee of drie?
    let samen = 0
    for (let j = 0; j < over.length && !samen; j++) {
      samen = samenvoeging(over, j, w)
      if (samen) over.splice(j, samen)
    }
    if (samen) continue
    // Of staat het hier juist los en aan de andere kant aan elkaar?
    let gevonden = false
    for (let j = 0; j < over.length && !gevonden; j++) {
      const n = samenvoeging(bronwoorden, b, over[j])
      if (n) {
        over.splice(j, 1)
        b += n - 1
        gevonden = true
      }
    }
    if (!gevonden) return null
  }
  return over.length
}

// Hoeveel woorden er extra mogen staan, als deel van het gerecht uit het ontwerp.
// Zonder die grens zou "Burrata | tomatenmix | truffelolie" blijven hangen aan het
// losse gerecht "Burrata": alle woorden daarvan staan er immers in. Bij een kort
// gerecht mag er altijd minstens een woord bij, anders zou "Pinsa | provolone |
// tomatenchutney" het ontwerp-gerecht "Provolone | tomatenchutney" niet vinden.
// Een woord te veel is context; een woord te weinig is een ander gerecht, en daar
// gaat de dekking hierboven over.
const RUIS = 0.4
const RUIS_MINIMAAL = 1

/**
 * Namen die de ontwerper afkort en de bibliotheek voluit schrijft. Dat is geen
 * tikfout en geen ander gerecht: hetzelfde broodje, twee schrijfwijzen, en de
 * dekkingsregel kan ze niet aan elkaar knopen omdat "wit" te kort is om als
 * verschrijving van "witte" te mogen tellen. Op het scherm wint het ontwerp, dus
 * vertalen we de bibliotheeknaam naar die van de ontwerper.
 *
 * Houd deze lijst kort en letterlijk. Elke regel hier is een plek waar het ontwerp
 * en de bibliotheek uit elkaar lopen; als er veel bijkomen is dat een teken dat er
 * iets anders mis is.
 */
const ALIASSEN = [
  [/\bwitte baguette\b/gi, 'Wit'],
]

function viaAlias(tekst) {
  let t = String(tekst)
  for (const [van, naar] of ALIASSEN) t = t.replace(van, naar)
  return t
}

/**
 * Zoekt het gerecht uit de bibliotheek dat hier is ingetypt.
 *
 * @param {string} getypt  naam en ingredienten zoals aangeleverd
 * @param {object} gerechten  de laag `gerechten` uit gerechten.json
 * @param {number|string} grootte  het corps van de naam in dit pakket
 * @returns {{sleutel: string, gerecht: object}|null}
 */
export function zoekGerecht(getypt, gerechten, grootte) {
  getypt = viaAlias(getypt)
  const voorvoegsel = `${grootte}|`
  const sleutel = voorvoegsel + gerechtsleutel(getypt)
  if (gerechten[sleutel]) return { sleutel, gerecht: gerechten[sleutel], letterlijk: true }

  const treffers = []
  for (const [k, gerecht] of Object.entries(gerechten)) {
    if (!k.startsWith(voorvoegsel)) continue
    const bron = k.slice(voorvoegsel.length)
    const extra = overtollig(bron, getypt)
    if (extra === null || extra > Math.max(RUIS_MINIMAAL, woorden(bron).length * RUIS)) continue
    treffers.push({ extra, sleutel: k, gerecht })
  }
  if (!treffers.length) return null
  treffers.sort((a, b) => a.extra - b.extra)
  // Twee gerechten die er even goed op passen: dan weten we het niet, en dan
  // raden we niet. Onze eigen afbreking is beter dan het verkeerde gerecht.
  if (treffers.length > 1 && treffers[0].extra === treffers[1].extra) return null
  return { sleutel: treffers[0].sleutel, gerecht: treffers[0].gerecht, letterlijk: false }
}
