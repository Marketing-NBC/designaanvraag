import { describe, expect, it } from 'vitest'
import { renderOpleveringMail, verslagProef, verslagVerstuurd } from './oplevering'
import {
  SLEUTEL, isTorenschermAanvraag, mediaType, nieuweSleutel, ontwerpPad, previewNaam, teGrootVoorPreview, torenschermBestanden, torenschermUrl,
} from './torenscherm-preview'

const b = (naam: string, host = 'asana') => ({ naam, host })

describe('torenscherm-preview', () => {
  it('alleen bij een torenscherm, en alleen waar we een foto van hebben', () => {
    expect(isTorenschermAanvraag(['torenscherm'], 'nbc')).toBe(true)
    expect(isTorenschermAanvraag(['led_kolom', 'torenscherm'], 'nbc')).toBe(true)
    expect(isTorenschermAanvraag(['led_kolom'], 'nbc')).toBe(false)
    expect(isTorenschermAanvraag(['torenscherm'], 'green_village')).toBe(false)
    expect(isTorenschermAanvraag(null, 'nbc')).toBe(false)
  })

  it('kent beelden en video, geen pdf of zip', () => {
    expect(mediaType('Scherm.JPG')).toBe('image/jpeg')
    expect(mediaType('anim.gif')).toBe('image/gif')
    expect(mediaType('loop.mp4')).toBe('video/mp4')
    expect(mediaType('export.mov')).toBe('video/quicktime')
    expect(mediaType('drukwerk.pdf')).toBeNull()
    expect(mediaType('bestanden.zip')).toBeNull()
    expect(mediaType('zonder-extensie')).toBeNull()
  })

  it('alleen een torenscherm gevraagd: elk beeld en elke video in de subtaak', () => {
    const lijst = [b('ontwerp.jpg'), b('anim.gif'), b('drukwerk.pdf'), b('link.png', 'onedrive')]
    expect(torenschermBestanden(lijst, ['torenscherm']).map((x) => x.naam)).toEqual(['ontwerp.jpg', 'anim.gif'])
  })

  it('meer designs gevraagd: alleen bestanden met "toren" in de naam', () => {
    const lijst = [b('Koffiescherm.png'), b('EY_Torenscherm.mp4'), b('TOREN.jpg'), b('ledkolom.mp4')]
    expect(torenschermBestanden(lijst, ['torenscherm', 'koffiescherm']).map((x) => x.naam)).toEqual(['EY_Torenscherm.mp4', 'TOREN.jpg'])
  })

  it('maakt van de bestandsnaam een nette naam', () => {
    expect(previewNaam('EY_Torenscherm_v2.mp4')).toBe('EY Torenscherm v2')
    expect(previewNaam('.png')).toBe('Torenscherm')
  })

  it('een sleutel is 24 hextekens en elke keer anders', () => {
    const a = nieuweSleutel()
    expect(a).toMatch(SLEUTEL)
    expect(nieuweSleutel()).not.toBe(a)
  })

  it('pad en link', () => {
    expect(ontwerpPad('abc', 'Scherm.JPEG')).toBe('abc/ontwerp.jpeg')
    expect(torenschermUrl('0123456789abcdef01234567')).toBe('https://marketing-nbc.github.io/designaanvraag/torenscherm/?p=0123456789abcdef01234567')
  })

  it('te groot voor de bucket', () => {
    expect(teGrootVoorPreview('a.mp4', 10 * 1024 * 1024)).toBeNull()
    expect(teGrootVoorPreview('a.mp4', 60 * 1024 * 1024)).toMatch(/^a\.mp4 is 60 MB.*hooguit 50 MB/)
  })
})

describe('torenscherm in de opleveringsmail', () => {
  const basis = {
    aan: ['britt@nbcevents.nl'], antwoordAan: ['marketing@nbcevents.nl'], aanvraagId: '11111111-2222-4333-8444-555555555555', versie: 1,
    locatie: 'nbc' as const, soort: 'evenement' as const, event: 'EY', eventDatum: '2026-12-11', omschrijving: '', types: ['torenscherm' as const],
    andersTekst: '', berichtHtml: 'Hierbij het torenscherm.', afzenderNaam: 'Devi', aanvrager: 'Britt', akkoord: true, bijlagen: [], links: [],
  }

  it('een knop naar de preview', () => {
    const m = renderOpleveringMail({ ...basis, torenschermen: [{ naam: 'EY', url: 'https://x.test/torenscherm/?p=abc' }] })
    expect(m.html).toContain('Bekijk het design op het torenscherm')
    expect(m.html).toContain('href="https://x.test/torenscherm/?p=abc"')
    expect(m.html).toContain('>Bekijk op het torenscherm<')
  })

  it('zonder preview geen kopje', () => {
    expect(renderOpleveringMail(basis).html).not.toContain('op het torenscherm')
  })

  it('in de verslagen in Asana', () => {
    const t = [{ naam: 'EY', url: 'https://x.test/?p=abc' }]
    expect(verslagProef({ naar: 'devi@nbcevents.nl', aan: ['britt@nbcevents.nl'], bijlagen: [], links: [], torenschermen: t }))
      .toContain('britt@nbcevents.nl. Op het torenscherm: <a href="https://x.test/?p=abc">EY</a>.')
    const v = verslagVerstuurd({ versie: 1, aan: ['britt@nbcevents.nl'], bijlagen: [], links: [], datum: '2026-11-06', torenschermen: t })
    expect(v).toContain('Op het torenscherm:')
    expect(v).not.toContain('Zonder bijlagen')
  })
})
