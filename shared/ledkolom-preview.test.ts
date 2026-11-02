import { describe, expect, it } from 'vitest'
import {
  SLUG, isLedkolomAanvraag, previewMisluktReden, previewUrl, releaseNaam, verslagPreviewKlaar, verslagWachtOpPreview, vindReleaseLinks,
  zonderReleaseLinks,
} from './ledkolom-preview'
import { beschrijvingAlsMailHtml } from './oplevering'

const REPO = 'https://github.com/Marketing-NBC/NBC-3D-ledkolom-Preview'
const TAG = `${REPO}/releases/tag/malmberg-4-nov`
const BESTAND = `${REPO}/releases/download/malmberg-4-nov/Malmberg.-.4.nov.mp4`

describe('3D-preview van de ledkolom', () => {
  it('alleen bij een aanvraag met een LED-kolom', () => {
    expect(isLedkolomAanvraag(['led_kolom', 'torenscherm'])).toBe(true)
    expect(isLedkolomAanvraag(['torenscherm'])).toBe(false)
    expect(isLedkolomAanvraag(null)).toBe(false)
  })

  it('vindt release-links, ook als Asana ze twee keer in de HTML zet', () => {
    const html = `<body>Hier is hij:\n<a href="${TAG}">${TAG}</a>\nen nog eentje: ${BESTAND}</body>`
    expect(vindReleaseLinks(html)).toEqual([TAG, BESTAND])
  })

  it('schrijft een link altijd hetzelfde, wat er ook achter staat', () => {
    const anders = 'https://github.com/marketing-nbc/nbc-3d-ledkolom-preview/releases/tag/malmberg-4-nov/?x=1#a'
    expect(vindReleaseLinks(anders)).toEqual([TAG])
  })

  it('negeert andere GitHub-links', () => {
    expect(vindReleaseLinks('https://github.com/Marketing-NBC/designaanvraag/releases/tag/x en ' + REPO)).toEqual([])
    expect(vindReleaseLinks(`${REPO}/releases/new`)).toEqual([])
  })

  it('haalt de links uit de tekst voor de mail, en een regel die leeg wordt verdwijnt', () => {
    const html = `<body>Hierbij de <strong>ledkolom</strong>.\n<a href="${TAG}">${TAG}</a>\nGroet</body>`
    const zonder = zonderReleaseLinks(html)
    expect(zonder).not.toContain('github.com')
    expect(beschrijvingAlsMailHtml(zonder)).toBe('Hierbij de <strong>ledkolom</strong>.<br>Groet')
  })

  it('een link als eerste regel neemt de body-tag niet mee', () => {
    const zonder = zonderReleaseLinks(`<body><a href="${TAG}">${TAG}</a>\nTekst</body>`)
    expect(zonder).toBe('<body>\nTekst</body>')
    expect(beschrijvingAlsMailHtml(zonder)).toBe('Tekst')
  })

  it('een link midden in een zin laat de rest van de zin staan', () => {
    expect(beschrijvingAlsMailHtml(zonderReleaseLinks(`<body>De kolom (${TAG}) is klaar.</body>`))).toBe('De kolom () is klaar.')
    expect(vindReleaseLinks(`Zie ${TAG}. En ${REPO}/releases/tag/v1.2, toch?`)).toEqual([TAG, `${REPO}/releases/tag/v1.2`])
  })

  it('noemt een release zoals Marketing hem kent', () => {
    expect(releaseNaam(TAG)).toBe('release "malmberg-4-nov"')
    expect(releaseNaam(BESTAND)).toBe('"Malmberg.-.4.nov.mp4" uit release "malmberg-4-nov"')
  })

  it('de link naar de preview, en welke mappen er mogen', () => {
    expect(previewUrl('malmberg-4-nov-0a1b2c3d')).toBe('https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/p/malmberg-4-nov-0a1b2c3d/')
    expect(SLUG.test('malmberg-4-nov-0a1b2c3d')).toBe(true)
    expect(SLUG.test('../etc-0a1b2c3d')).toBe(false)
    expect(SLUG.test('malmberg')).toBe(false)
  })

  it('de reacties', () => {
    expect(verslagWachtOpPreview(1)).toContain('wordt verstuurd zodra de 3D-ledkolom klaar is')
    expect(verslagWachtOpPreview(2)).toContain('zodra de 3D-ledkolommen klaar zijn')
    expect(verslagPreviewKlaar([{ naam: 'A & B', url: 'https://x/p/a/' }])).toContain('<a href="https://x/p/a/">A &amp; B</a>')
    expect(previewMisluktReden(TAG, 'Breder dan hoog')).toBe('De 3D-ledkolom van release "malmberg-4-nov" kon niet gemaakt worden: Breder dan hoog.')
  })
})
