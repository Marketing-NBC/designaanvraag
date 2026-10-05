/**
 * Waar het logo van de opdrachtgever komt te staan, en hoe groot.
 *
 * Afgeleid uit het referentiebestand waarin Abel zeven logo's met de hand heeft
 * geplaatst - breed, vierkant, rond, en een met zijn eigen achtergrondvlak. Uit die
 * zeven komt geen vaste hoogte, geen vaste breedte en geen vaste oppervlakte, maar
 * wel dit: de **kortste zijde** ligt steeds rond de 330 pixels. Dat is ook logisch.
 * Een breed logo is een band en wordt begrensd door zijn hoogte; een vierkant of rond
 * logo is een blok en wordt begrensd door zijn breedte. Bij een gelijke korte zijde
 * wegen ze optisch even zwaar, en dat is wat het scherm nodig heeft.
 *
 * Twee kanttekeningen bij die herkomst. Het gaat om zeven plaatsingen die met het oog
 * zijn gemaakt, dus de regel is een samenvatting en geen natuurwet. En de vergelijking
 * draait om het beeld: of dit goed staat, bepaalt de ontwerper, niet dit bestand.
 */

/** De kortste zijde van het logo. Hieraan hangt de optische grootte. */
export const KORTE_ZIJDE = 330

/** Ruimte tussen het logo en de blob. Minder en het logo gaat erin hangen. */
export const BLOB_MARGE = 150

/** Bovenmarge van het scherm; het basisontwerp zet zijn logovak op y=74. */
export const BOVEN_MARGE = 64

/** Ruimte tussen de onderkant van het logo en de eerste tekstregel. */
export const TEKST_MARGE = 100

/** Zo ver mag een heel breed logo naar links doorlopen. */
export const LINKER_GRENS = 1200

/**
 * Staat er helemaal geen tekst onder het logo, dan houdt alleen dit hem tegen. Het
 * diepste dat in het referentiebestand voorkomt is 612; hier net voorbij, zodat een
 * rond logo lucht heeft zonder dat het midden op het scherm belandt.
 */
export const ONDER_GRENS = 640

/**
 * Hoe laag het logo mag komen als zijn linkerrand op `links` ligt.
 *
 * Alleen tekst die werkelijk onder het logo zou komen telt mee. Een kop in de linker
 * kolom hoeft een logo dat rechtsboven staat niet in de weg te zitten; dat is ook wat
 * er in het referentiebestand gebeurt, waar het ronde NVWA-logo lager komt dan de
 * eerste kop omdat het daar ver rechts van staat.
 */
function grensOnder(ruimte, links) {
  let eerste = Infinity
  for (const k of ruimte?.kolommen ?? []) {
    if (k.x1 > links) eerste = Math.min(eerste, k.boven)
  }
  // Geen kolom onder het logo betekent geen tekst om rekening mee te houden. Dan
  // begrenst alleen ONDER_GRENS hem; terugvallen op de eerste tekstregel elders op het
  // scherm zou het logo kleiner maken om iets wat er niet onder staat.
  if (!Number.isFinite(eerste)) return ONDER_GRENS
  return Math.min(eerste - TEKST_MARGE, ONDER_GRENS)
}

/** Het logo zo groot mogelijk binnen deze strook, met de korte zijde als richtmaat. */
function pasIn(bron, strook) {
  let schaal = KORTE_ZIJDE / Math.min(bron.breedte, bron.hoogte)
  const krap = { hoogte: false, breedte: false }
  if (bron.hoogte * schaal > strook.hoogte) {
    schaal = strook.hoogte / bron.hoogte
    krap.hoogte = true
  }
  if (bron.breedte * schaal > strook.breedte) {
    schaal = strook.breedte / bron.breedte
    krap.breedte = true
    krap.hoogte = false
  }
  return { schaal, breedte: bron.breedte * schaal, hoogte: bron.hoogte * schaal,
           krap: krap.breedte || krap.hoogte }
}

/**
 * Waar het logo komt te staan.
 *
 * @param {object} logo    { breedte, hoogte } van het logo zoals het is, bijgesneden
 * @param {object} ruimte  { blobRand, eersteTekst, kolommen: [{x0, x1, boven}] }
 * @returns {{x, y, breedte, hoogte, schaal, soort, krap}}
 */
export function plaatsLogo(logo, ruimte) {
  const bron = { breedte: Math.max(1, logo?.breedte ?? 1), hoogte: Math.max(1, logo?.hoogte ?? 1) }
  const verhouding = bron.breedte / bron.hoogte
  const rechts = ruimte.blobRand - BLOB_MARGE

  // Hoe laag het logo mag, hangt af van hoe breed hij wordt, en zijn breedte hangt af
  // van hoe laag hij mag. Daarom zoeken we het in een paar rondes op: ruim beginnen,
  // kijken welke kolommen er dan werkelijk onder liggen, en opnieuw meten. Dat kan in
  // theorie blijven pendelen tussen twee standen, dus daarna knijpen we hoe dan ook af
  // op wat er bij de uiteindelijke breedte past. Overlap met tekst kan zo niet.
  const strookBreedte = rechts - LINKER_GRENS
  let onder = ONDER_GRENS
  let maat = pasIn(bron, { breedte: strookBreedte, hoogte: onder - BOVEN_MARGE })
  for (let ronde = 0; ronde < 6; ronde++) {
    const grens = grensOnder(ruimte, rechts - maat.breedte)
    if (Math.abs(grens - onder) < 0.5) break
    onder = grens
    maat = pasIn(bron, { breedte: strookBreedte, hoogte: onder - BOVEN_MARGE })
  }
  const definitief = grensOnder(ruimte, rechts - maat.breedte)
  if (BOVEN_MARGE + maat.hoogte > definitief) {
    onder = definitief
    maat = pasIn(bron, { breedte: strookBreedte, hoogte: onder - BOVEN_MARGE })
  }

  return {
    x: rechts - maat.breedte,
    y: BOVEN_MARGE + ((onder - BOVEN_MARGE) - maat.hoogte) / 2,
    breedte: maat.breedte,
    hoogte: maat.hoogte,
    schaal: maat.schaal,
    soort: verhouding >= 1.5 ? 'breed' : verhouding <= 1 / 1.5 ? 'staand' : 'vierkant',
    krap: maat.krap,
  }
}

/**
 * Is het aangeleverde bestand scherp genoeg voor de maat waarop het komt te staan?
 *
 * Het scherm is 3840 pixels breed en wordt van dichtbij bekeken, dus een logo dat
 * opgeblazen moet worden valt op. Een SVG schaalt mee en is altijd goed; bij een
 * foto-bestand telt hoeveel pixels er werkelijk in zitten.
 *
 * @returns {string|null} de waarschuwing, of null als het in orde is
 */
export function scherptewaarschuwing({ bron, plaatsing, vector = false }) {
  if (vector || !bron?.breedte) return null
  const nodig = plaatsing.breedte
  if (bron.breedte >= nodig) return null
  const tekort = nodig / bron.breedte
  const hoe = tekort >= 2 ? 'fors' : 'iets'
  return `Het logo wordt ${hoe} opgeblazen: het bestand is ${Math.round(bron.breedte)} pixels `
    + `breed en komt op ${Math.round(nodig)} te staan. Vraag om een scherper bestand of een SVG `
    + 'als het er zacht uitziet.'
}
