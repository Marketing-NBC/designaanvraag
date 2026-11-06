/**
 * Een plat design in perspectief op een foto zetten, met alleen CSS: een `matrix3d` die de rechthoek
 * van het design (0,0)-(breedte,hoogte) precies op de vier opgemeten hoeken van het scherm legt.
 * Werkt op een plaatje, een gif en een video, en de browser rekent het per beeld zelf uit.
 *
 * Hoe: de projectieve afbeelding van het eenheidsvierkant op een vierhoek (Heckbert, "Fundamentals
 * of Texture Mapping and Image Warping", 1989), daarna geschaald naar de maat van het design.
 */

export type Punt = readonly [number, number]

/** De hoeken van het scherm op de foto, in pixels van de foto: linksboven, rechtsboven, rechtsonder, linksonder. */
export type Hoeken = readonly [Punt, Punt, Punt, Punt]

/**
 * De 3x3-matrix [a b c; d e f; g h 1] die (u,v) in het eenheidsvierkant afbeeldt op de vierhoek:
 * x = (a·u + b·v + c) / (g·u + h·v + 1), y = (d·u + e·v + f) / (g·u + h·v + 1).
 */
export function vierkantNaarVierhoek([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]: Hoeken): number[] {
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const dy3 = y0 - y1 + y2 - y3
  const noemer = dx1 * dy2 - dx2 * dy1
  const g = noemer === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / noemer
  const h = noemer === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / noemer
  return [
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h, 1,
  ]
}

/** Waar een punt van het design op de foto terechtkomt; voor de tests en om na te rekenen. */
export function projecteer(hoeken: Hoeken, breedte: number, hoogte: number, [x, y]: Punt): [number, number] {
  const [a, b, c, d, e, f, g, h] = vierkantNaarVierhoek(hoeken)
  const u = x / breedte
  const v = y / hoogte
  const w = g * u + h * v + 1
  return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]
}

/**
 * De CSS-transform voor een element van `breedte` x `hoogte` pixels met `transform-origin: 0 0`,
 * linksboven in de foto. matrix3d is kolom voor kolom: x, y, z, en de vierde rij is de perspectief-deling.
 */
export function matrix3d(hoeken: Hoeken, breedte: number, hoogte: number): string {
  const [a, b, c, d, e, f, g, h] = vierkantNaarVierhoek(hoeken)
  const m = [
    a / breedte, d / breedte, 0, g / breedte,
    b / hoogte, e / hoogte, 0, h / hoogte,
    0, 0, 1, 0,
    c, f, 0, 1,
  ]
  return `matrix3d(${m.map((n) => Number(n.toPrecision(10))).join(',')})`
}
