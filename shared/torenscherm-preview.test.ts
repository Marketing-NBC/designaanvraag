import { describe, expect, it } from 'vitest'
import { renderOpleveringMail, verslagProef, verslagVerstuurd } from './oplevering'
import { isTorenschermAanvraag, torenschermBeeldNaam, torenschermBestanden, torenschermCid } from './torenscherm-preview'

const b = (naam: string, host = 'asana', bytes: number | null = 1000) => ({ naam, host, bytes })

describe('torenscherm in de opleveringsmail', () => {
  it('alleen bij een torenscherm, en alleen waar we een foto van hebben', () => {
    expect(isTorenschermAanvraag(['torenscherm'], 'nbc')).toBe(true)
    expect(isTorenschermAanvraag(['led_kolom', 'torenscherm'], 'nbc')).toBe(true)
    expect(isTorenschermAanvraag(['led_kolom'], 'nbc')).toBe(false)
    expect(isTorenschermAanvraag(['torenscherm'], 'green_village')).toBe(false)
    expect(isTorenschermAanvraag(null, 'nbc')).toBe(false)
  })

  it('alleen een torenscherm gevraagd: elke jpg, png en gif in de subtaak', () => {
    const lijst = [b('ontwerp.JPG'), b('anim.gif'), b('scherm.png'), b('drukwerk.pdf'), b('loop.mp4'), b('link.png', 'onedrive')]
    expect(torenschermBestanden(lijst, ['torenscherm']).map((x) => x.naam)).toEqual(['ontwerp.JPG', 'anim.gif', 'scherm.png'])
  })

  it('meer designs gevraagd: alleen beelden met "toren" in de naam', () => {
    const lijst = [b('Koffiescherm.png'), b('EY_Torenscherm.jpg'), b('TOREN.gif'), b('Torenscherm.mp4')]
    expect(torenschermBestanden(lijst, ['torenscherm', 'koffiescherm']).map((x) => x.naam)).toEqual(['EY_Torenscherm.jpg', 'TOREN.gif'])
  })

  it('een heel groot bestand niet: dat past niet in de rekentijd', () => {
    expect(torenschermBestanden([b('toren.png', 'asana', 40 * 1024 * 1024)], ['torenscherm'])).toEqual([])
  })

  it('naam en Content-ID van de afbeelding', () => {
    expect(torenschermBeeldNaam('EY_Welkom.png')).toBe('Torenscherm - EY_Welkom.jpg')
    expect(torenschermCid(0)).toBe('torenscherm-1@designaanvraag')
  })

  const basis = {
    aan: ['britt@nbcevents.nl'], antwoordAan: ['marketing@nbcevents.nl'], aanvraagId: '11111111-2222-4333-8444-555555555555', versie: 1,
    locatie: 'nbc' as const, soort: 'evenement' as const, event: 'EY', eventDatum: '2026-12-11', omschrijving: '', types: ['torenscherm' as const],
    andersTekst: '', berichtHtml: 'Hierbij het torenscherm.', afzenderNaam: 'Devi', aanvrager: 'Britt', akkoord: true, bijlagen: [], links: [],
  }

  it('de afbeelding staat in de mail, direct onder het bericht, zonder knop', () => {
    const html = renderOpleveringMail({ ...basis, torenscherm: [{ naam: 'EY', cid: 'torenscherm-1@designaanvraag' }] }).html
    expect(html).toContain('<img src="cid:torenscherm-1@designaanvraag" width="552" alt="EY op het torenscherm"')
    expect(html.indexOf('Hierbij het torenscherm.')).toBeLessThan(html.indexOf('cid:torenscherm-1'))
    expect(html.indexOf('cid:torenscherm-1')).toBeLessThan(html.indexOf('Feedback geven'))
    expect(html).not.toContain('Bekijk op het torenscherm')
  })

  it('zonder afbeelding geen kopje', () => {
    expect(renderOpleveringMail(basis).html).not.toContain('torenscherm bij de ingang')
  })

  it('in de reactie bij de taak', () => {
    const t = { gelukt: ['EY.png'], mislukt: [{ naam: 'oud.gif', reden: 'het bestand is niet te lezen' }] }
    const p = verslagProef({ naar: 'devi@nbcevents.nl', aan: ['britt@nbcevents.nl'], bijlagen: ['EY.png', 'oud.gif'], links: [], torenscherm: t })
    expect(p).toContain('Op de foto van het torenscherm in de mail: EY.png.')
    expect(p).toContain('oud.gif kon niet op de foto van het torenscherm (het bestand is niet te lezen); die gaat alleen als bijlage mee.')
    expect(verslagVerstuurd({ versie: 1, aan: ['britt@nbcevents.nl'], bijlagen: ['EY.png'], links: [], datum: '2026-11-06', torenscherm: t }))
      .toContain('Op de foto van het torenscherm in de mail: EY.png.')
  })
})
