/**
 * De huisstijl van de opdrachtgever op het menuscherm.
 *
 * Standaard is alles NBC: blobs in het verloop oranje-naar-teal uit het
 * Illustrator-bestand, kopjes en het bestek-icoon in het NBC-oranje. Ongeveer een op
 * de vijf opdrachtgevers wil zijn eigen kleuren. De huisstijl-Routine heeft die al van
 * de website van de opdrachtgever gehaald en in `brand_result` gezet; hier kiezen we
 * eruit wat op het scherm terechtkomt.
 *
 * Dan wordt het één kleur, niet twee. Het verloop hoort bij de NBC-huisstijl; bij een
 * andere opdrachtgever worden de blobs één vlak in zijn basiskleur, en zijn
 * accentkleur gaat naar de kopjes. Twee merkkleuren door elkaar klutsen levert een
 * verloop op dat in geen enkele huisstijl zo staat. Is er geen bruikbare accentkleur,
 * dan krijgen de kopjes de basiskleur - alles van het merk, niets van NBC.
 *
 * Het blijft een keuze die iemand moet nakijken. Een merkkleur die op een website
 * prima werkt kan als vlak van twee meter breed heel anders uitpakken, dus wat
 * gekozen is komt altijd in de Asana-comment te staan.
 */

/** Rollen die nooit een merkkleur kunnen zijn: dat zijn de kleuren van papier en inkt. */
const GEEN_MERKKLEUR = new Set(['background', 'text'])

const rgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''))
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const helderheid = (hex) => {
  const c = rgb(hex)
  return c ? (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 : null
}

/**
 * Te licht of te donker om als blob te werken. Wit valt weg tegen het scherm en
 * zwart maakt er een gat van; in beide gevallen is het geen blob meer.
 */
function bruikbaar(hex) {
  const h = helderheid(hex)
  return h !== null && h > 28 && h < 235
}

/**
 * Leesbaar als kopje op wit? Het NBC-oranje zelf zit op 169, dus heel streng hoeft
 * het niet - maar boven de 200 wordt een kopje op een wit scherm onleesbaar, en
 * kopjes zijn juist de houvast op zo'n scherm.
 */
function leesbaarOpWit(hex) {
  const h = helderheid(hex)
  return h !== null && h < 200
}

// Is er geen hoofdkleur in de brief, dan kiezen we in deze volgorde een vervanger
// voor de blobs.
const VOORKEUR = ['secondary', 'accent', 'other']
// Voor het accent ligt het andersom: een accentkleur is bedoeld om mee te
// benadrukken, en dat is precies wat een kopje doet.
const VOORKEUR_ACCENT = ['accent', 'primary', 'secondary', 'other']

const rang = (lijst, rol) => {
  const i = lijst.indexOf(rol)
  return i === -1 ? lijst.length : i
}

const omschrijf = (k) => (k.name ? `${k.hex} (${k.name})` : k.hex)

/**
 * Kiest de kleuren voor het scherm uit een huisstijl-brief.
 *
 * Neemt zowel de brief zelf als de hele `aanvragen.brand_result` aan. Dat laatste is
 * `{ brief, assets, ... }`, en wie dat doorgaf kreeg stilletjes nul kleuren terug: de
 * kleuren zitten een laag dieper. Daarom pakt deze functie het zelf uit.
 *
 * @param {object|null} bron  aanvragen.brand_result, of de brand-brief zelf
 * @returns {{basis, accent, uitleg}|{reden: string}}
 */
export function merkKleuren(bron) {
  const brief = bron?.colors ? bron : bron?.brief
  const kleuren = (brief?.colors ?? []).filter((k) => !GEEN_MERKKLEUR.has(k.role) && rgb(k.hex))
  const bruikbare = kleuren.filter((k) => bruikbaar(k.hex))

  const volgorde = (lijst) => [...bruikbare].sort(
    (a, b) => rang(lijst, a.role) - rang(lijst, b.role)
      || bruikbare.indexOf(a) - bruikbare.indexOf(b))

  // De hoofdkleur wordt het grote vlak, ook als hij heel donker is. Daar is het merk aan
  // te herkennen; een steunkleur die toevallig lichter is maakt er het scherm van een
  // ander merk van. Een marineblauw hoort dus op het scherm, niet het rood ernaast.
  //
  // De enige hoofdkleur die we overslaan is een bijna-witte: die levert geen donker
  // scherm op maar een leeg scherm, want de blobs vallen weg tegen het wit.
  const hoofd = kleuren.find((k) => k.role === 'primary')
  const basis = (hoofd && helderheid(hoofd.hex) < 235 ? hoofd : null) ?? volgorde(VOORKEUR)[0]
  if (!basis) {
    return { reden: 'In de huisstijl van de opdrachtgever staat geen kleur die als blob kan werken.' }
  }
  // Is er geen accentkleur die als kopje leesbaar blijft, dan krijgen de kopjes de
  // basiskleur. Terugvallen op NBC-oranje zou een vreemde kleur het scherm in halen
  // die bij deze opdrachtgever nergens staat; één merkkleur overal is dan beter.
  const accent = volgorde(VOORKEUR_ACCENT).find((k) => k !== basis && leesbaarOpWit(k.hex)) ?? basis

  // Welke kleur het geworden is én waarom: anders is bij een scherm dat er raar uitziet
  // niet te zien of de keuze fout was of de huisstijl-brief.
  const ROLNAAM = { primary: 'de hoofdkleur', secondary: 'een steunkleur',
                    accent: 'de accentkleur', other: 'een losse kleur' }
  const rol = ROLNAAM[basis.role] ?? 'een kleur zonder rol'
  const delen = [`De blobs worden één vlak in ${omschrijf(basis)}, ${rol} uit de huisstijl.`]
  delen.push(accent === basis
    ? 'De kopjes en het bestek-icoon krijgen dezelfde kleur.'
    : `De kopjes en het bestek-icoon worden ${omschrijf(accent)}, ${ROLNAAM[accent.role] ?? 'een kleur zonder rol'}.`)
  if (basis.role !== 'primary' && !kleuren.some((k) => k.role === 'primary')) {
    delen.push('In de huisstijl staat geen hoofdkleur, vandaar die keuze.')
  }
  if (!bruikbaar(basis.hex)) {
    delen.push('Let op: die kleur is heel donker, dus de blobs worden een zwaar vlak.')
  }
  if (hoofd && hoofd !== basis) {
    delen.push(`De hoofdkleur ${omschrijf(hoofd)} is bijna wit; daarmee zouden de blobs `
      + 'wegvallen tegen het scherm, dus die is overgeslagen.')
  }
  if (!leesbaarOpWit(accent.hex)) {
    delen.push('Let op: de kleur van de kopjes is licht, dus die kunnen op het witte scherm '
      + 'zwak uitvallen.')
  }
  delen.push('Kijk dat even na.')

  return { basis: basis.hex, accent: accent.hex, uitleg: delen.join(' ') }
}

// ── Kleuren die Marketing zelf intikt ────────────────────────────────

/** Maakt er #rrggbb van, of null. Accepteert ook zonder hekje en in drie tekens. */
function hex(stuk) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(stuk ?? '').trim())
  if (!m) return null
  const h = m[1].toLowerCase()
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`
}

/**
 * De kleuren uit het Asana-veld "Menukleuren".
 *
 * Niet elke opdrachtgever heeft een website waar een huisstijl uit te halen valt, en
 * soms bevalt de gevonden kleur gewoon niet. Dan tikt Marketing hem hier in: één
 * hexcode voor de blobs, of twee voor de blobs en de kopjes.
 *
 * Wat hier staat is een opdracht, geen suggestie: te licht of te donker weigeren we
 * niet, want hoe het eruitziet beoordeelt degene die het intikte. We zeggen het wel.
 *
 * @param {string|null} tekst  de inhoud van het veld
 * @returns {{basis, accent, uitleg}|{reden: string}|null}  null als het veld leeg is
 */
export function handmatigeKleuren(tekst) {
  const ruw = String(tekst ?? '').trim()
  if (!ruw) return null
  const stukken = ruw.split(/[\s,;/|]+/).filter(Boolean)
  const gevonden = stukken.map(hex).filter(Boolean)
  if (!gevonden.length) {
    return { reden: `In het veld "Menukleuren" staat "${ruw.slice(0, 60)}", en daar zit geen `
      + 'hexkleur in (zoiets als #5b2d8e).' }
  }

  const [basis, tweede] = gevonden
  const accent = tweede ?? basis
  const delen = [`De blobs worden één vlak in ${basis}, zoals ingevuld bij "Menukleuren".`]
  delen.push(accent === basis
    ? 'De kopjes en het bestek-icoon krijgen dezelfde kleur.'
    : `De kopjes en het bestek-icoon worden ${accent}.`)
  if (gevonden.length > 2) {
    delen.push(`Er stonden ${gevonden.length} kleuren in het veld; de eerste twee zijn gebruikt.`)
  }
  if (!bruikbaar(basis)) {
    delen.push(helderheid(basis) >= 235
      ? 'Let op: die basiskleur is bijna wit, dus de blobs vallen weg tegen het scherm.'
      : 'Let op: die basiskleur is bijna zwart, dus de blobs worden een gat in het scherm.')
  }
  if (!leesbaarOpWit(accent)) {
    delen.push('Let op: de kleur van de kopjes is licht, dus die kunnen op het witte scherm '
      + 'zwak uitvallen.')
  }

  return { basis, accent, uitleg: delen.join(' ') }
}
