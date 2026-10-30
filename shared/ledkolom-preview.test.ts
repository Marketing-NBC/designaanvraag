import { describe, expect, it } from 'vitest'
import {
  SLUG, isLedkolomAanvraag, ledkolomVideos, nieuweSlug, previewMisluktReden, previewNaam, previewUrl, slugify, verslagWachtOpPreview,
} from './ledkolom-preview'
import type { AsanaBestand } from './oplevering'

const bestand = (naam: string, over: Partial<AsanaBestand> = {}): AsanaBestand =>
  ({ gid: naam, naam, bytes: 1, createdAt: '2026-10-30T10:00:00Z', host: 'asana', viewUrl: null, ...over })

describe('3D-preview van de ledkolom', () => {
  it('alleen bij een aanvraag met een LED-kolom', () => {
    expect(isLedkolomAanvraag(['led_kolom', 'torenscherm'])).toBe(true)
    expect(isLedkolomAanvraag(['torenscherm'])).toBe(false)
    expect(isLedkolomAanvraag(null)).toBe(false)
  })

  it('pakt geüploade video\'s, in de volgorde waarin ze erbij kwamen', () => {
    const lijst = [
      bestand('b.MP4', { createdAt: '2026-10-30T11:00:00Z' }),
      bestand('a.mov'),
      bestand('logo.png'),
      bestand('op-onedrive.mp4', { host: 'onedrive' }),
    ]
    expect(ledkolomVideos(lijst).map((b) => b.naam)).toEqual(['a.mov', 'b.MP4'])
  })

  it('de naam: event en datum, met een nummer bij meer kolommen; intern de bestandsnaam', () => {
    const ev = { soort: 'evenement' as const, event: 'Malmberg', eventDatum: '2026-11-04' }
    expect(previewNaam(ev, { naam: 'x.mp4' }, 1, 1)).toBe('Malmberg - 4 november')
    expect(previewNaam(ev, { naam: 'x.mp4' }, 2, 2)).toBe('Malmberg - 4 november - kolom 2')
    expect(previewNaam({ soort: 'intern', event: '', eventDatum: null }, { naam: 'Kerst_ledkolom.mp4' }, 1, 1)).toBe('Kerst ledkolom')
  })

  it('slugify doet hetzelfde als tools/build.mjs in de 3D-repo', () => {
    // Uit LINKS.md daar: de map van "Nederlandse Transplantatie Vereniging - 22 okt".
    expect(slugify('Nederlandse Transplantatie Vereniging - 22 okt')).toBe('nederlandse-transplantatie-vereniging-22')
    expect(slugify('Café De Ster')).toBe('cafe-de-ster')
    expect(slugify('!!!')).toBe('kolom')
  })

  it('een nieuwe slug heeft het staartje van acht tekens dat de 3D-repo verwacht', () => {
    const slug = nieuweSlug('Malmberg - 4 november', () => new Uint8Array([0x0a, 0x1b, 0x2c, 0x3d]))
    expect(slug).toBe('malmberg-4-november-0a1b2c3d')
    expect(SLUG.test(slug)).toBe(true)
    expect(SLUG.test(nieuweSlug('Wat dan ook'))).toBe(true)
    expect(SLUG.test('../etc-0a1b2c3d')).toBe(false)
  })

  it('de link', () => {
    expect(previewUrl('malmberg-0a1b2c3d')).toBe('https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/p/malmberg-0a1b2c3d/')
  })

  it('de reactie bij wachten zegt dat hij vanzelf gaat', () => {
    const html = verslagWachtOpPreview([{ naam: 'A & B', url: 'https://x/p/a/' }])
    expect(html).toContain('wordt verstuurd zodra de 3D-ledkolom klaar is')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('Je hoeft niets meer te doen')
  })

  it('de reden bij een mislukte preview', () => {
    expect(previewMisluktReden('Malmberg', 'Breder dan hoog')).toBe(
      'De 3D-ledkolom "Malmberg" kon niet gemaakt worden: Breder dan hoog. Zet een nieuwe video in de subtaak Oplevering.',
    )
  })
})
