/**
 * De 3D-preview van een ledkolom, bij het opleveren.
 *
 * Een ledkolomvideo is 300 à 400 MB, en Asana neemt maar 100 MB per bestand aan. Daarom loopt de
 * video zoals altijd via een release in de repository NBC-3D-ledkolom-Preview (daar mag een bestand
 * tot 2 GB zijn). Marketing plakt de link van die release in de beschrijving van de subtaak
 * Oplevering. De 3D-repo maakt er de preview van (de kolom in 3D en op de foto van de foyer), en de
 * opleveringsmail krijgt in plaats van de GitHub-link een knop naar die preview.
 *
 * Puur: gegevens erin, keuzes en tekst eruit. De webhook en de function ledkolom-preview doen de rest.
 */
import type { RequestTypeKey } from './request-types.ts'

/** Waar de previews online staan (GitHub Pages van de 3D-repo). */
export const LEDKOLOM_PREVIEW_BASIS = 'https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/'

/** De repository en workflow die de previews bouwen. */
export const LEDKOLOM_PREVIEW_REPO = 'Marketing-NBC/NBC-3D-ledkolom-Preview'
export const LEDKOLOM_PREVIEW_WORKFLOW = 'publiceer-preview.yml'

/**
 * Laat de 3D-repo na zoveel minuten nog niets horen, dan is de run waarschijnlijk niet eens begonnen
 * (GitHub gooit een wachtende run weg als er een nieuwere achter komt). Dan starten we hem bij de
 * volgende druk op de knop opnieuw.
 */
export const LEDKOLOM_VASTGELOPEN_MIN = 15

/** Bij welke aanvragen een release-link een 3D-preview wordt: alleen als er een LED-kolom gevraagd is. */
export function isLedkolomAanvraag(types: readonly RequestTypeKey[] | null | undefined): boolean {
  return (types ?? []).includes('led_kolom')
}

const DEEL = `[^\\s"'<>?#/()]+`
/**
 * Een link naar een release (alle video's daarin) of naar één bestand van een release. Een punt of
 * komma aan het eind hoort bij de zin, niet bij de link: een git-tag mag niet op een punt eindigen.
 */
const RELEASE_LINK = new RegExp(
  `https?://github\\.com/${LEDKOLOM_PREVIEW_REPO.replace('/', '\\/')}/releases/(?:tag/${DEEL}|download/${DEEL}/${DEEL})(?<![.,;:!])/?(?:[?#][^\\s"'<>()]*)?`,
  'gi',
)

/** Altijd dezelfde schrijfwijze, zodat dezelfde link bij een tweede druk op de knop dezelfde rij is. */
function normaliseer(link: string): string {
  const pad = link.replace(/[?#].*$/, '').replace(/\/$/, '').replace(/^.*?\/releases\//i, '')
  return `https://github.com/${LEDKOLOM_PREVIEW_REPO}/releases/${pad}`
}

/**
 * De release-links in de beschrijving van de subtaak, in volgorde en zonder dubbelen. Asana zet een
 * link twee keer in de HTML (in href en als tekst); dat telt als één.
 */
export function vindReleaseLinks(html: string): string[] {
  const tekst = html.replace(/&amp;/g, '&')
  const gezien = new Set<string>()
  const uit: string[] = []
  for (const m of tekst.matchAll(RELEASE_LINK)) {
    const link = normaliseer(m[0])
    if (gezien.has(link.toLowerCase())) continue
    gezien.add(link.toLowerCase())
    uit.push(link)
  }
  return uit
}

/**
 * De beschrijving zonder de release-links: de aanvrager krijgt een knop naar de preview, geen link naar
 * GitHub. Een regel waar daarna niets meer op staat, verdwijnt helemaal.
 */
export function zonderReleaseLinks(html: string): string {
  const bron = RELEASE_LINK.source
  const inAnker = new RegExp(`<a\\b[^>]*href=["']${bron}["'][^>]*>[\\s\\S]*?<\\/a>`, 'gi')
  const los = new RegExp(bron, 'gi')
  return html
    .split('\n')
    .map((regel) => {
      const nieuw = regel.replace(inAnker, '').replace(los, '')
      if (nieuw === regel) return regel
      const tags = nieuw.match(/<[^>]*>/g)?.join('') ?? ''
      return nieuw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() ? nieuw : (tags || null)
    })
    .filter((r): r is string => r !== null)
    .join('\n')
}

/** Hoe een release-link in een melding heet: 'release "malmberg-4-nov"'. */
export function releaseNaam(link: string): string {
  const pad = link.replace(/^.*?\/releases\//i, '')
  const ontsleutel = (s: string) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  const delen = pad.split('/').map(ontsleutel)
  return delen[0] === 'download' ? `"${delen[2] ?? ''}" uit release "${delen[1] ?? ''}"` : `release "${delen[1] ?? ''}"`
}

/** Zoals tools/build.mjs in de 3D-repo een map noemt: een naam plus acht hextekens. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}$/

export function previewUrl(slug: string, basis = LEDKOLOM_PREVIEW_BASIS): string {
  return `${basis.replace(/\/?$/, '/')}p/${slug}/`
}

/** Een preview zoals de opleveringsmail en de reacties hem laten zien. */
export interface PreviewLink {
  naam: string
  url: string
}

function escapeAsana(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function asanaLink(p: PreviewLink): string {
  return `<a href="${escapeAsana(p.url)}">${escapeAsana(p.naam)}</a>`
}

/**
 * De reactie als "Verstuur nu" moet wachten tot de preview online staat. Je hoeft niets meer te doen:
 * de function ledkolom-preview verstuurt hem zodra de 3D-repo laat weten dat hij klaar is.
 */
export function verslagWachtOpPreview(aantal: number): string {
  const wat = aantal > 1 ? 'de 3D-ledkolommen klaar zijn' : 'de 3D-ledkolom klaar is'
  return `<body>De opleveringsmail wordt verstuurd zodra ${wat}. Dat duurt meestal een paar minuten. Je hoeft niets meer te doen; `
    + 'staat de mail er over een kwartier nog niet, zet Oplevermail dan opnieuw op Verstuur nu.</body>'
}

/** De reactie als een preview online staat en er geen mail op wachtte (na een proef bijvoorbeeld). */
export function verslagPreviewKlaar(previews: PreviewLink[]): string {
  return `<body>De 3D-ledkolom staat online: ${previews.map(asanaLink).join(', ')}. `
    + 'Zet Oplevermail op Verstuur nu als alles klopt.</body>'
}

/** De reactie als de 3D-repo de release niet kon verwerken en er geen mail op wachtte. */
export function verslagPreviewMislukt(bron: string, reden: string, vermeldGid: string | null): string {
  const vermelding = vermeldGid ? `<a data-asana-gid="${escapeAsana(vermeldGid)}"/> ` : ''
  return `<body>${vermelding}De 3D-ledkolom van ${escapeAsana(releaseNaam(bron))} kon <strong>niet</strong> gemaakt worden. ${escapeAsana(reden)} `
    + 'Los het op in de release (of zet een andere link in de subtaak Oplevering) en probeer het opnieuw met Stuur proef naar mij.</body>'
}

/** De reden in "Mislukt" als een mail niet door kan omdat de preview mislukte. */
export function previewMisluktReden(bron: string, reden: string): string {
  const r = reden.trim()
  return `De 3D-ledkolom van ${releaseNaam(bron)} kon niet gemaakt worden: ${r}${/[.!?]$/.test(r) ? '' : '.'}`
}
