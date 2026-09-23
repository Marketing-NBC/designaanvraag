/**
 * Leest de menu-invulling zoals die bij NBC binnenkomt en zet hem om in de vorm
 * die de opmaak-engine verwacht.
 *
 * Zo wordt het aangeleverd:
 *
 *     Invulling menu:
 *     Op tafel
 *
 *     • Bruschetta-spiezen met seasonal dips
 *
 *     Voorgerecht
 *
 *     • Gerookte hoenderfilet | gel van basilicum en appel | gepofte boekweit
 *
 * Een regel met een bolletje is een gerecht; alles ervoor tot de streep is de
 * naam, daarachter staan de ingredienten. Elke andere regel met tekst is een
 * kopje. Lege regels doen niet mee.
 *
 * Een gerecht kan onderdelen hebben (zoals de Tartelettes in Grab & Go). Die
 * herken je aan een bolletje dat inspringt, of aan een streepje onder een
 * gerecht met een bolletje:
 *
 *     • Tartelettes
 *       - Rundertartaar | umamicreme | kwartelei
 *       - Tallegio (vega) | romige tallegio | kruidencrunch
 */

const BOLLETJES = ['•', '‣', '◦', '·', '●', '▪', '*']
const STREEPJES = ['-', '–', '—']
const ALLE_MARKERS = [...BOLLETJES, ...STREEPJES]

// Regels die het menu inleiden en er zelf niet bij horen.
const INLEIDINGEN = /^(invulling\s*menu|menu|menu-?invulling|culinaire\s*invulling)\s*:?\s*$/i

/** Hoe ver een regel inspringt, met een tab als vier spaties. */
function inspringing(regel) {
  const wit = regel.match(/^[\t ]*/)[0]
  return wit.replace(/\t/g, '    ').length
}

function markerVan(regel) {
  const kaal = regel.trim()
  for (const m of ALLE_MARKERS) {
    if (kaal.startsWith(m)) return m
  }
  return null
}

/** Splitst "naam | deel | deel" in een naam en de delen erachter. */
function splitsOpStreep(tekst) {
  const delen = tekst.split('|').map((s) => s.trim()).filter(Boolean)
  return { naam: delen[0] ?? '', rest: delen.slice(1) }
}

/**
 * @param {string} tekst  de geplakte menu-invulling
 * @returns {{ secties: Array, opmerkingen: string[] }}
 */
export function leesMenuTekst(tekst) {
  const opmerkingen = []
  const regels = String(tekst ?? '').split(/\r?\n/)

  // Eerst bepalen welk teken de gerechten markeert en welk teken de onderdelen.
  // Staan er twee soorten, dan is het meest gebruikte het gerecht-teken.
  const tellen = new Map()
  for (const regel of regels) {
    const m = markerVan(regel)
    if (m) tellen.set(m, (tellen.get(m) ?? 0) + 1)
  }
  const gesorteerd = [...tellen.entries()].sort((a, b) => b[1] - a[1])
  const gerechtMarker = gesorteerd[0]?.[0] ?? null

  const secties = []
  let sectie = null
  let gerecht = null

  for (const ruweRegel of regels) {
    const regel = ruweRegel.trim()
    if (!regel) continue
    if (INLEIDINGEN.test(regel)) continue

    const marker = markerVan(ruweRegel)
    if (!marker) {
      // Geen bolletje: dit is een kopje.
      sectie = { kop: regel, gerechten: [] }
      secties.push(sectie)
      gerecht = null
      continue
    }

    const inhoud = regel.slice(marker.length).trim()
    if (!inhoud) continue

    // Onderdeel van het gerecht erboven: een ander teken dan het gerecht-teken,
    // of hetzelfde teken maar verder ingesprongen.
    const isOnderdeel = gerecht
      && (marker !== gerechtMarker || inspringing(ruweRegel) > (gerecht._inspringing ?? 0))

    if (isOnderdeel) {
      const { naam, rest } = splitsOpStreep(inhoud)
      if (!gerecht.onderdelen) {
        gerecht.onderdelen = []
        // Een gerecht met onderdelen heeft zelf geen rij ingredienten meer.
        if (gerecht.ingredienten?.length) {
          opmerkingen.push(`"${gerecht.naam}" had ingredienten en krijgt nu ook onderdelen; `
            + 'de ingredienten zijn als eerste onderdeel gezet.')
          gerecht.onderdelen.push({ naam: gerecht.ingredienten[0], toelichting: gerecht.ingredienten.slice(1) })
        }
        delete gerecht.ingredienten
      }
      gerecht.onderdelen.push({ naam, ...(rest.length ? { toelichting: rest } : {}) })
      continue
    }

    if (!sectie) {
      sectie = { kop: '', gerechten: [] }
      secties.push(sectie)
      opmerkingen.push('Het eerste gerecht staat zonder kopje erboven.')
    }
    const { naam, rest } = splitsOpStreep(inhoud)
    gerecht = { naam, ...(rest.length ? { ingredienten: rest } : {}) }
    gerecht._inspringing = inspringing(ruweRegel)
    sectie.gerechten.push(gerecht)
  }

  for (const s of secties) for (const g of s.gerechten) delete g._inspringing
  const leeg = secties.filter((s) => s.gerechten.length === 0)
  for (const s of leeg) {
    opmerkingen.push(`Onder kopje "${s.kop}" staat geen gerecht.`)
  }

  return { secties: secties.filter((s) => s.gerechten.length > 0), opmerkingen }
}

/** Kopjes vergelijkbaar maken: kleine letters, geen leestekens, geen dubbele spaties. */
function sleutel(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Zoekt het basisontwerp dat bij deze secties hoort.
 *
 * De pakketten verschillen in hun kopjes: een viergangen diner heeft Op tafel /
 * Voorgerecht / Tussengerecht / Hoofdgerecht / Nagerecht, een driegangen mist de
 * Tussengerecht. Daar is het pakket aan te herkennen, zodat niemand het er apart
 * bij hoeft te zetten.
 *
 * @param {Array} secties       uit leesMenuTekst
 * @param {Array} basisLijst    [{ pakket, koppen: string[], gerechten: number }]
 * @returns {{ pakket: string|null, score: number, uitleg: string }}
 */
export function kiesPakket(secties, basisLijst) {
  const koppen = secties.map((s) => sleutel(s.kop))
  const gerechten = secties.reduce((n, s) => n + s.gerechten.length, 0)

  const uitslagen = basisLijst.map((basis) => {
    const doel = basis.koppen.map(sleutel)
    const gevonden = new Set()
    let raak = 0
    for (const kop of koppen) {
      const i = doel.findIndex((d, idx) => !gevonden.has(idx) && (d === kop || d.includes(kop) || kop.includes(d)))
      if (i >= 0) {
        gevonden.add(i)
        raak += 1
      }
    }
    // Alle kopjes moeten kloppen, aan beide kanten: een driegangen menu past ook
    // "half" in een viergangen ontwerp, en dat is niet hetzelfde.
    const score = raak / Math.max(koppen.length, doel.length, 1)
    // Het aantal gerechten telt licht mee als de kopjes gelijk scoren.
    const gerechtVerschil = Math.abs(gerechten - basis.gerechten) / Math.max(gerechten, basis.gerechten, 1)
    return { pakket: basis.pakket, score, totaal: score - gerechtVerschil * 0.05 }
  }).sort((a, b) => b.totaal - a.totaal)

  const beste = uitslagen[0]
  const tweede = uitslagen[1]

  if (!beste || beste.score < 0.6) {
    return {
      pakket: null,
      score: beste?.score ?? 0,
      uitleg: `De kopjes (${secties.map((s) => s.kop).join(' / ')}) passen bij geen enkel basisontwerp.`,
    }
  }
  if (tweede && beste.totaal - tweede.totaal < 0.05) {
    return {
      pakket: beste.pakket,
      score: beste.score,
      uitleg: `De kopjes passen zowel bij ${beste.pakket} als bij ${tweede.pakket}; `
        + `${beste.pakket} is gekozen. Controleer of dat klopt.`,
    }
  }
  return {
    pakket: beste.pakket,
    score: beste.score,
    uitleg: beste.score === 1
      ? `De kopjes komen precies overeen met ${beste.pakket}.`
      : `De kopjes lijken het meest op ${beste.pakket} (${Math.round(beste.score * 100)}% van de kopjes komt overeen).`,
  }
}
