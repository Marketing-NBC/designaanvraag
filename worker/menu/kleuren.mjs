/**
 * De huisstijl van de opdrachtgever op het menuscherm.
 *
 * Standaard is alles NBC: blobs oranje-naar-teal, kopjes en het bestek-icoon in het
 * NBC-oranje. Ongeveer een op de vijf opdrachtgevers wil zijn eigen kleuren. De
 * huisstijl-Routine heeft die al van de website van de opdrachtgever gehaald en in
 * `brand_result` gezet; hier kiezen we eruit wat op het scherm terechtkomt.
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

// Van welke rol we het liefst de bovenste blob maken. De onderste wordt de
// volgende in de rij, zodat er verloop in blijft zitten.
const VOORKEUR = ['primary', 'secondary', 'accent', 'other']
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
 * @param {object|null} brief  de inhoud van aanvragen.brand_result
 * @returns {{boven, onder, accent, uitleg}|{reden: string}}
 */
export function merkKleuren(brief) {
  const kleuren = (brief?.colors ?? []).filter(
    (k) => !GEEN_MERKKLEUR.has(k.role) && bruikbaar(k.hex))
  if (kleuren.length < 2) {
    return { reden: kleuren.length === 0
      ? 'In de huisstijl van de opdrachtgever staat geen kleur die als blob kan werken.'
      : 'In de huisstijl van de opdrachtgever staat maar één bruikbare kleur; '
        + 'voor het verloop in de blobs zijn er twee nodig.' }
  }

  const volgorde = (lijst) => [...kleuren].sort(
    (a, b) => rang(lijst, a.role) - rang(lijst, b.role)
      || kleuren.indexOf(a) - kleuren.indexOf(b))

  const [boven, onder] = volgorde(VOORKEUR)
  const accent = volgorde(VOORKEUR_ACCENT).find((k) => leesbaarOpWit(k.hex)) ?? null

  const delen = [`De blobs kleuren mee met de opdrachtgever: ${omschrijf(boven)} naar `
    + `${omschrijf(onder)}.`]
  delen.push(accent
    ? `De kopjes en het bestek-icoon worden ${omschrijf(accent)}.`
    : 'Geen van de merkkleuren is donker genoeg voor een leesbaar kopje op wit, dus de '
      + 'kopjes en het bestek-icoon blijven NBC-oranje.')
  delen.push('Kijk dat even na.')

  return { boven: boven.hex, onder: onder.hex, accent: accent?.hex ?? null,
           uitleg: delen.join(' ') }
}
