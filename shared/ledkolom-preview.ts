/**
 * De 3D-preview van een ledkolom, gemaakt bij het opleveren.
 *
 * Zet Marketing bij een LED-kolom-aanvraag de video in de subtaak Oplevering, dan gaat die niet als
 * bijlage mee (te groot, en de aanvrager ziet er toch niet veel aan). In plaats daarvan maakt de
 * repository NBC-3D-ledkolom-Preview er een preview van: de kolom in 3D en op de foto van de foyer.
 * De opleveringsmail krijgt de link.
 *
 * De link bepalen wij, niet de 3D-repo: dan weten we hem al voordat de preview gebouwd is, en blijft
 * hij hetzelfde bij een volgende versie. De vorm is die van tools/build.mjs daar: een leesbare naam
 * plus een willekeurig staartje van acht tekens, zodat wie één link heeft de andere niet kan raden.
 *
 * Puur: gegevens erin, keuzes en tekst eruit. De webhook en de function ledkolom-preview doen de rest.
 */
import { formatDateShortNl, kortVan } from './asana-title.ts'
import type { AsanaBestand } from './oplevering.ts'
import type { RequestTypeKey, Soort } from './request-types.ts'

/** Waar de previews online staan (GitHub Pages van de 3D-repo). */
export const LEDKOLOM_PREVIEW_BASIS = 'https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/'

/** De repository en workflow die de previews bouwen. */
export const LEDKOLOM_PREVIEW_REPO = 'Marketing-NBC/NBC-3D-ledkolom-Preview'
export const LEDKOLOM_PREVIEW_WORKFLOW = 'publiceer-preview.yml'

/**
 * Staat een preview na zoveel minuten nog niet online, dan is de build waarschijnlijk niet eens
 * begonnen (GitHub gooit een wachtende run weg als er een nieuwere achter komt). Dan starten we hem
 * bij de volgende druk op de knop opnieuw.
 */
export const LEDKOLOM_VASTGELOPEN_MIN = 15

/** Bij welke aanvragen de video een 3D-preview wordt: alleen als er een LED-kolom gevraagd is. */
export function isLedkolomAanvraag(types: readonly RequestTypeKey[] | null | undefined): boolean {
  return (types ?? []).includes('led_kolom')
}

const VIDEO = /\.(mp4|mov|m4v)$/i

/**
 * De ledkolomvideo's tussen de bijlagen van de subtaak, in de volgorde waarin ze erbij kwamen. Alleen
 * geüploade bestanden: een gekoppeld bestand op OneDrive kunnen we niet ophalen.
 */
export function ledkolomVideos(bestanden: readonly AsanaBestand[]): AsanaBestand[] {
  return bestanden
    .filter((b) => b.host === 'asana' && VIDEO.test(b.naam))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

/**
 * De naam op het startscherm van de preview: "Malmberg - 4 november". Bij meer dan één kolom komt
 * het nummer erachter. Zonder event (een interne aanvraag) de bestandsnaam.
 */
export function previewNaam(
  a: { soort: Soort; event: string; eventDatum: string | null },
  video: { naam: string },
  volgnummer: number,
  aantal: number,
): string {
  const event = a.soort === 'intern' ? '' : a.event.trim()
  const basis = event
    ? [kortVan(event, 60), a.eventDatum ? formatDateShortNl(a.eventDatum, false) : ''].filter(Boolean).join(' - ')
    : video.naam.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s{2,}/g, ' ').trim() || 'Ledkolom'
  return event && aantal > 1 ? `${basis} - kolom ${volgnummer}` : basis
}

/** Precies dezelfde regel als slugify() in tools/build.mjs van de 3D-repo. */
export function slugify(s: string): string {
  let x = s.toLowerCase()
  x = x.normalize('NFD').replace(/[̀-ͯ]/g, '')
  x = x.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!x) x = 'kolom'
  if (x.length > 40) x = x.slice(0, 40).replace(/-+$/, '')
  return x
}

/** Een nieuwe slug: de naam plus acht willekeurige hextekens. */
export function nieuweSlug(naam: string, willekeurig: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(4))): string {
  const staart = Array.from(willekeurig().slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('')
  return `${slugify(naam)}-${staart}`
}

/** Zoals tools/build.mjs hem accepteert; alles anders weigert de 3D-repo. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}$/

export function previewUrl(slug: string, basis = LEDKOLOM_PREVIEW_BASIS): string {
  return `${basis.replace(/\/?$/, '/')}p/${slug}/`
}

/** Een preview zoals de opleveringsmail hem laat zien. */
export interface PreviewInMail {
  naam: string
  url: string
  /** Staat hij al online? Alleen in een proefmail kan dat nog niet zo zijn. */
  klaar: boolean
}

function escapeAsana(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function asanaLink(p: { naam: string; url: string }): string {
  return `<a href="${escapeAsana(p.url)}">${escapeAsana(p.naam)}</a>`
}

/**
 * De reactie als "Verstuur nu" moet wachten tot de preview online staat. Je hoeft niets meer te doen:
 * de function ledkolom-preview verstuurt hem zodra de 3D-repo laat weten dat hij klaar is.
 */
export function verslagWachtOpPreview(previews: { naam: string; url: string }[]): string {
  const wat = previews.length > 1 ? 'de 3D-ledkolommen' : 'de 3D-ledkolom'
  return `<body>De opleveringsmail wordt verstuurd zodra ${wat} klaar ${previews.length > 1 ? 'zijn' : 'is'}: `
    + `${previews.map(asanaLink).join(', ')}. Dat duurt meestal een paar minuten. Je hoeft niets meer te doen; `
    + 'staat de mail er over een kwartier nog niet, zet Oplevermail dan opnieuw op Verstuur nu.</body>'
}

/** De reactie als een preview online staat en er geen mail op wachtte (na een proef bijvoorbeeld). */
export function verslagPreviewKlaar(p: { naam: string; url: string }): string {
  return `<body>De 3D-ledkolom staat online: ${asanaLink(p)}.</body>`
}

/** De reactie als de 3D-repo de video niet kon verwerken en er geen mail op wachtte. */
export function verslagPreviewMislukt(p: { naam: string }, reden: string, vermeldGid: string | null): string {
  const vermelding = vermeldGid ? `<a data-asana-gid="${escapeAsana(vermeldGid)}"/> ` : ''
  return `<body>${vermelding}De 3D-ledkolom "${escapeAsana(p.naam)}" kon <strong>niet</strong> gemaakt worden. ${escapeAsana(reden)} `
    + 'Zet een nieuwe video in de subtaak Oplevering, of probeer het opnieuw met Stuur proef naar mij.</body>'
}

/** De reden in "Mislukt" als een wachtende mail niet door kan omdat de preview mislukte. */
export function previewMisluktReden(naam: string, reden: string): string {
  return `De 3D-ledkolom "${naam}" kon niet gemaakt worden: ${reden.replace(/\s+$/, '')}${/[.!?]$/.test(reden.trim()) ? '' : '.'} `
    + 'Zet een nieuwe video in de subtaak Oplevering.'
}
