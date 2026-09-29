/**
 * De blobs laten meekleuren met de opdrachtgever.
 *
 * Standaard zijn de blobs oranje-naar-teal: de NBC-huisstijl. Ongeveer een op de
 * vijf opdrachtgevers wil ze in zijn eigen kleuren. De huisstijl-Routine heeft die
 * kleuren al van de website van de opdrachtgever gehaald en in `brand_result`
 * gezet; hier kiezen we er twee uit.
 *
 * Het blijft een keuze die iemand moet nakijken. Een merkkleur die op een website
 * prima werkt kan als vlak van twee meter breed heel anders uitpakken, dus welke
 * kleuren gekozen zijn komt altijd in de Asana-comment te staan.
 */

/** Rollen die nooit een blob kunnen zijn: dat zijn de kleuren van papier en inkt. */
const GEEN_BLOB = new Set(['background', 'text'])

const rgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''))
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Te licht of te donker om als blob te werken. Wit valt weg tegen het scherm en
 * zwart maakt er een gat van; in beide gevallen is het geen blob meer.
 */
function bruikbaar(hex) {
  const c = rgb(hex)
  if (!c) return false
  const helderheid = (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000
  return helderheid > 28 && helderheid < 235
}

// Van welke rol we het liefst de bovenste blob maken. De onderste wordt de
// volgende in de rij, zodat er verloop in blijft zitten.
const VOORKEUR = ['primary', 'secondary', 'accent', 'other']

/**
 * Kiest de twee blobkleuren uit een huisstijl-brief.
 *
 * @param {object|null} brief  de inhoud van aanvragen.brand_result
 * @returns {{boven: string, onder: string, uitleg: string}|{reden: string}}
 */
export function blobKleuren(brief) {
  const kleuren = (brief?.colors ?? []).filter((k) => !GEEN_BLOB.has(k.role) && bruikbaar(k.hex))
  if (kleuren.length < 2) {
    return { reden: kleuren.length === 0
      ? 'In de huisstijl van de opdrachtgever staat geen kleur die als blob kan werken.'
      : 'In de huisstijl van de opdrachtgever staat maar één bruikbare kleur; '
        + 'voor het verloop in de blobs zijn er twee nodig.' }
  }
  const op = [...kleuren].sort(
    (a, b) => rang(a.role) - rang(b.role) || kleuren.indexOf(a) - kleuren.indexOf(b))
  const [boven, onder] = op
  return {
    boven: boven.hex,
    onder: onder.hex,
    uitleg: `De blobs kleuren mee met de opdrachtgever: ${omschrijf(boven)} naar `
      + `${omschrijf(onder)}. Kijk dat even na.`,
  }
}

const rang = (rol) => {
  const i = VOORKEUR.indexOf(rol)
  return i === -1 ? VOORKEUR.length : i
}

const omschrijf = (k) => (k.name ? `${k.hex} (${k.name})` : k.hex)
