import { describe, expect, it } from 'vitest'
import {
  beschrijvingAlsMailHtml, feedbackUrl, isOpleverSubtaak, leesOntvangers, openOpleverSubtaak, renderOpleveringMail, teGrootMelding,
  uniekeAdressen, verdeelBijlagen, verslagMislukt, verslagProef, verslagVerstuurd, verstuurdeSubtaakNaam, type AsanaBestand,
  type OpleveringMail, type Subtaak,
} from './oplevering'

describe('de subtaak Oplevering', () => {
  const sub = (gid: string, naam: string, completed = false, createdAt = '2026-10-01T10:00:00Z'): Subtaak =>
    ({ gid, naam, completed, createdAt, html: '' })

  it('herkent de naam, hoofdletters maken niet uit', () => {
    expect(isOpleverSubtaak('Oplevering')).toBe(true)
    expect(isOpleverSubtaak('oplevering versie 2')).toBe(true)
    expect(isOpleverSubtaak('Torenscherm Zorgcongres')).toBe(false)
    expect(isOpleverSubtaak('Opleveringen archief')).toBe(false)
  })

  it('de open subtaak telt; afgevinkte zijn eerdere versies', () => {
    expect(openOpleverSubtaak([
      sub('v1', 'Oplevering versie 1 - verstuurd 20 oktober', true),
      sub('scherm', 'Torenscherm Zorgcongres'),
      sub('nu', 'Oplevering', false, '2026-10-21T10:00:00Z'),
    ])?.gid).toBe('nu')
    expect(openOpleverSubtaak([sub('v1', 'Oplevering versie 1', true)])).toBeNull()
  })

  it('zijn er twee open, dan de nieuwste', () => {
    expect(openOpleverSubtaak([sub('a', 'Oplevering', false, '2026-10-01T10:00:00Z'), sub('b', 'Oplevering', false, '2026-10-05T10:00:00Z')])?.gid).toBe('b')
  })

  it('na het versturen heet hij naar zijn versie', () => {
    expect(verstuurdeSubtaakNaam(2, '2026-10-28')).toBe('Oplevering versie 2 - verstuurd 28 oktober')
  })
})

describe('bijlagen van de subtaak', () => {
  const b = (gid: string, createdAt: string, over: Partial<AsanaBestand> = {}): AsanaBestand =>
    ({ gid, naam: `${gid}.png`, bytes: 100, createdAt, host: 'asana', viewUrl: null, ...over })

  it('alles wat erbij staat, in de volgorde waarin het erbij kwam', () => {
    const keuze = verdeelBijlagen([b('tweede', '2026-10-28T10:00:00Z'), b('eerste', '2026-10-28T09:00:00Z')])
    expect(keuze.bestanden.map((x) => x.gid)).toEqual(['eerste', 'tweede'])
    expect(keuze.totaalBytes).toBe(200)
  })

  it('een koppeling naar OneDrive of Google Drive gaat als link, niet als bijlage', () => {
    const keuze = verdeelBijlagen([b('map', '2026-10-28T09:59:00Z', { host: 'onedrive', bytes: null, viewUrl: 'https://x/map' })])
    expect(keuze.bestanden).toEqual([])
    expect(keuze.links.map((x) => x.gid)).toEqual(['map'])
  })

  it('te groot geeft een melding met de grootte; wat past niet', () => {
    const keuze = verdeelBijlagen([b('groot', '2026-10-28T09:59:00Z', { bytes: 21 * 1024 * 1024 })])
    expect(teGrootMelding(keuze)).toMatch(/samen 21,0 MB, en er past hooguit 20,0 MB/)
    expect(teGrootMelding(verdeelBijlagen([b('klein', '2026-10-28T09:59:00Z')]))).toBeNull()
  })
})

describe('ontvangers', () => {
  it('komma, puntkomma, spaties en regels als scheiding', () => {
    expect(leesOntvangers('a@x.nl, b@x.nl;c@x.nl\nd@x.nl  e@x.nl').geldig).toEqual(['a@x.nl', 'b@x.nl', 'c@x.nl', 'd@x.nl', 'e@x.nl'])
  })

  it('geplakt uit Outlook', () => {
    expect(leesOntvangers('Jan Jansen <jan@klant.nl>; "Piet, de Vries" <piet@klant.nl>')).toEqual({ geldig: ['jan@klant.nl', 'piet@klant.nl'], ongeldig: [] })
  })

  it('wat geen adres is, valt op', () => {
    expect(leesOntvangers('jan@klant.nl, piet, klaas@')).toEqual({ geldig: ['jan@klant.nl'], ongeldig: ['piet', 'klaas@'] })
  })

  it('leeg is leeg', () => {
    expect(leesOntvangers(null)).toEqual({ geldig: [], ongeldig: [] })
    expect(leesOntvangers('  ')).toEqual({ geldig: [], ongeldig: [] })
  })

  it('geen dubbelen, hoofdletters daargelaten', () => {
    expect(uniekeAdressen(['Britt@nbcevents.nl', 'britt@NBCevents.nl', 'jan@klant.nl'])).toEqual(['Britt@nbcevents.nl', 'jan@klant.nl'])
  })
})

describe('de beschrijving als mail', () => {
  it('regels, lijstjes en links blijven', () => {
    const html = beschrijvingAlsMailHtml('<body>Twee dingen:\n<ul>\n<li>torenscherm</li>\n<li>vlag</li>\n</ul>Zie <a href="https://wetransfer.com/x">WeTransfer</a></body>')
    expect(html).toContain('Twee dingen:<br>')
    expect(html).toContain('<ul style="margin:4px 0 4px 20px;padding:0;"><li style="margin:0 0 2px;">torenscherm</li><li style="margin:0 0 2px;">vlag</li></ul>')
    expect(html).toContain('<a href="https://wetransfer.com/x" style="color:#165e5a;">WeTransfer</a>')
  })

  it('een vermelding of een taaklink wordt gewone tekst', () => {
    const html = beschrijvingAlsMailHtml('<body>Met dank aan <a data-asana-gid="123" data-asana-type="user" href="https://app.asana.com/0/profile/123">@Devi</a><a data-asana-gid="9"/>.</body>')
    expect(html).toBe('Met dank aan @Devi.')
  })

  it('geen scripts, afbeeldingen of javascript-links', () => {
    const html = beschrijvingAlsMailHtml('<body><script>alert(1)</script><img src="x" onerror="y"><a href="javascript:alert(1)">klik</a> &lt;b&gt;</body>')
    expect(html).not.toMatch(/<script|<img|javascript:/)
    expect(html).toContain('klik')
    expect(html).toContain('&lt;b&gt;')
  })

  it('een losse sluittag breekt de opmaak niet', () => {
    expect(beschrijvingAlsMailHtml('<body><em>schuin</strong> en recht</body>')).toBe('<em>schuin en recht</em>')
  })

  it('een lege beschrijving is leeg', () => {
    expect(beschrijvingAlsMailHtml('<body></body>')).toBe('')
    expect(beschrijvingAlsMailHtml('<body>\n</body>')).toBe('')
  })
})

describe('de mail', () => {
  const basis: OpleveringMail = {
    aan: ['britt@nbcevents.nl'],
    antwoordAan: ['marketing@nbcevents.nl'],
    aanvraagId: '11111111-2222-4333-8444-555555555555',
    versie: 1,
    soort: 'evenement',
    event: 'Zorgcongres',
    eventDatum: '2026-12-11',
    omschrijving: '',
    types: ['torenscherm', 'vlaggen'],
    andersTekst: '',
    berichtHtml: 'Hier is het.',
    afzenderNaam: 'Devi',
    bijlagen: [{ naam: 'torenscherm.png', bytes: 2048 }],
    links: [],
  }

  it('onderwerp, bericht, bijlagen en de feedbackknop', () => {
    const m = renderOpleveringMail(basis)
    expect(m.onderwerp).toBe('Klaar: Zorgcongres - 11 december - Torenscherm, Vlaggen')
    expect(m.aan).toEqual(['britt@nbcevents.nl'])
    expect(m.antwoordAan).toEqual(['marketing@nbcevents.nl'])
    expect(m.html).toContain('Het design voor <strong>Zorgcongres</strong> staat klaar.')
    expect(m.html).toContain('Hier is het.')
    expect(m.html).toContain('Devi, Marketing')
    expect(m.html).toContain('torenscherm.png')
    expect(m.html).toContain('Feedback geven')
    expect(m.html).toContain(feedbackUrl(basis.aanvraagId))
  })

  it('een tweede versie zegt dat', () => {
    const m = renderOpleveringMail({ ...basis, versie: 2 })
    expect(m.onderwerp).toMatch(/^Versie 2 klaar: /)
    expect(m.html).toContain('Versie 2 van het design voor <strong>Zorgcongres</strong> staat klaar')
  })

  it('een interne aanvraag heeft geen event', () => {
    const m = renderOpleveringMail({ ...basis, soort: 'intern', event: '', eventDatum: null, types: [], omschrijving: 'Nieuwe visitekaartjes voor het salesteam' })
    expect(m.onderwerp).toBe('Klaar: Intern - Nieuwe visitekaartjes voor het salesteam')
    expect(m.html).toContain('Je aanvraag staat klaar.')
  })

  it('een proefmail zegt dat, en wie de echte krijgt', () => {
    const m = renderOpleveringMail({ ...basis, aan: ['abel@nbcevents.nl'], proef: { echteOntvangers: ['britt@nbcevents.nl', 'jan@klant.nl'] } })
    expect(m.aan).toEqual(['abel@nbcevents.nl'])
    expect(m.onderwerp).toBe('[PROEF] Klaar: Zorgcongres - 11 december - Torenscherm, Vlaggen')
    expect(m.html).toContain('De echte mail gaat naar britt@nbcevents.nl en jan@klant.nl')
    expect(m.html).toContain('Hier is het.')
  })

  it('de feedbacklink kiest de aanvraag', () => {
    expect(feedbackUrl('abc')).toBe('https://marketing-nbc.github.io/designaanvraag/?feedback=abc')
  })
})

describe('het verslag in Asana', () => {
  it('aan wie, met welke bestanden', () => {
    expect(verslagVerstuurd({ versie: 2, aan: ['a@x.nl', 'b@x.nl', 'c@x.nl'], bijlagen: ['x.png'], links: [], datum: '2026-10-28' }))
      .toBe('<body>Opleveringsmail (versie 2) verstuurd op 28 oktober 2026 aan a@x.nl, b@x.nl en c@x.nl. Bijlagen: x.png.</body>')
  })

  it('een mislukte poging vermeldt iemand en zegt wat je dan doet', () => {
    expect(verslagMislukt('Geen <ontvanger>.', 'devi')).toBe(
      '<body><a data-asana-gid="devi"/> De opleveringsmail is <strong>niet</strong> verstuurd. Geen &lt;ontvanger&gt;. '
        + 'Zet Oplevermail daarna opnieuw op Verstuur nu (of eerst op Stuur proef naar mij).</body>',
    )
    expect(verslagMislukt('x', null, true)).toMatch(/^<body>De proefmail is <strong>niet<\/strong> verstuurd/)
  })

  it('na een proef: waarheen, en wie de echte krijgt', () => {
    expect(verslagProef({ naar: 'abel@nbcevents.nl', aan: ['britt@nbcevents.nl', 'jan@klant.nl'], bijlagen: ['a.png', 'b.pdf'], links: [] }))
      .toBe('<body>Proefmail gestuurd naar abel@nbcevents.nl. De echte mail gaat naar britt@nbcevents.nl en jan@klant.nl, met a.png en b.pdf. '
        + 'Klopt alles, zet Oplevermail dan op Verstuur nu.</body>')
  })
})
