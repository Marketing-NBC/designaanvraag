import { describe, expect, it } from 'vitest'
import {
  bijlagenBijReactie, feedbackUrl, isOpleveringReactie, laatsteOpleveringReactie, leesOntvangers, reactieAlsMailHtml,
  renderOpleveringMail, teGrootMelding, uniekeAdressen, verslagMislukt, verslagVerstuurd, type AsanaBestand, type OpleveringMail,
  type Reactie,
} from './oplevering'

describe('de reactie herkennen', () => {
  it('begint met Oplevering:, hoofdletters en spaties maken niet uit', () => {
    expect(isOpleveringReactie('Oplevering: hier is het')).toBe(true)
    expect(isOpleveringReactie('  oplevering : hier is het')).toBe(true)
    expect(isOpleveringReactie('OPLEVERING:')).toBe(true)
    expect(isOpleveringReactie('De oplevering: volgt morgen')).toBe(false)
    expect(isOpleveringReactie('Oplevering volgt')).toBe(false)
  })

  it('de nieuwste telt', () => {
    const r = (gid: string, createdAt: string, tekst = 'Oplevering: x'): Reactie =>
      ({ gid, createdAt, tekst, html: '', auteurGid: null, auteurNaam: null })
    const gekozen = laatsteOpleveringReactie([
      r('a', '2026-10-01T10:00:00Z'),
      r('b', '2026-10-03T10:00:00Z'),
      r('c', '2026-10-04T10:00:00Z', 'Dank je!'),
      r('d', '2026-10-02T10:00:00Z'),
    ])
    expect(gekozen?.gid).toBe('b')
    expect(laatsteOpleveringReactie([r('c', '2026-10-04T10:00:00Z', 'Dank je!')])).toBeNull()
  })
})

describe('bestanden bij de reactie', () => {
  const b = (gid: string, createdAt: string, over: Partial<AsanaBestand> = {}): AsanaBestand =>
    ({ gid, naam: `${gid}.png`, bytes: 100, createdAt, host: 'asana', viewUrl: null, ...over })
  const reactie = { createdAt: '2026-10-28T10:00:00Z' }

  it('alleen wat rond het moment van de reactie bij de taak kwam', () => {
    const keuze = bijlagenBijReactie([
      b('oud', '2026-10-28T09:00:00Z'),
      b('ervoor', '2026-10-28T09:45:00Z'),
      b('erna', '2026-10-28T10:01:00Z'),
      b('later', '2026-10-28T10:30:00Z'),
    ], reactie)
    expect(keuze.bestanden.map((x) => x.gid)).toEqual(['ervoor', 'erna'])
    expect(keuze.totaalBytes).toBe(200)
  })

  it('een koppeling naar OneDrive of Google Drive gaat als link, niet als bijlage', () => {
    const keuze = bijlagenBijReactie([b('map', '2026-10-28T09:59:00Z', { host: 'onedrive', bytes: null, viewUrl: 'https://x/map' })], reactie)
    expect(keuze.bestanden).toEqual([])
    expect(keuze.links.map((x) => x.gid)).toEqual(['map'])
  })

  it('te groot geeft een melding met de grootte; wat past niet', () => {
    const keuze = bijlagenBijReactie([b('groot', '2026-10-28T09:59:00Z', { bytes: 21 * 1024 * 1024 })], reactie)
    expect(teGrootMelding(keuze)).toMatch(/samen 21,0 MB, en er past hooguit 20,0 MB/)
    expect(teGrootMelding(bijlagenBijReactie([b('klein', '2026-10-28T09:59:00Z')], reactie))).toBeNull()
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

describe('de reactie als mail', () => {
  it('zonder het woord Oplevering:, ook als dat vet staat', () => {
    expect(reactieAlsMailHtml('<body><strong>Oplevering:</strong> Hier is het torenscherm.</body>')).toBe('Hier is het torenscherm.')
    expect(reactieAlsMailHtml('<body>Oplevering: Hier is het.</body>')).toBe('Hier is het.')
  })

  it('regels, lijstjes en links blijven', () => {
    const html = reactieAlsMailHtml('<body>Oplevering: twee dingen:\n<ul>\n<li>torenscherm</li>\n<li>vlag</li>\n</ul>Zie <a href="https://wetransfer.com/x">WeTransfer</a></body>')
    expect(html).toContain('twee dingen:<br>')
    expect(html).toContain('<ul style="margin:4px 0 4px 20px;padding:0;"><li style="margin:0 0 2px;">torenscherm</li><li style="margin:0 0 2px;">vlag</li></ul>')
    expect(html).toContain('<a href="https://wetransfer.com/x" style="color:#165e5a;">WeTransfer</a>')
  })

  it('een vermelding of een taaklink wordt gewone tekst', () => {
    const html = reactieAlsMailHtml('<body>Oplevering: met dank aan <a data-asana-gid="123" data-asana-type="user" href="https://app.asana.com/0/profile/123">@Devi</a><a data-asana-gid="9"/>.</body>')
    expect(html).toBe('met dank aan @Devi.')
  })

  it('geen scripts, afbeeldingen of javascript-links', () => {
    const html = reactieAlsMailHtml('<body>Oplevering: <script>alert(1)</script><img src="x" onerror="y"><a href="javascript:alert(1)">klik</a> &lt;b&gt;</body>')
    expect(html).not.toMatch(/<script|<img|javascript:/)
    expect(html).toContain('klik')
    expect(html).toContain('&lt;b&gt;')
  })

  it('een losse sluittag breekt de opmaak niet', () => {
    expect(reactieAlsMailHtml('<body>Oplevering: <em>schuin</strong> en recht</body>')).toBe('<em>schuin en recht</em>')
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
      '<body><a data-asana-gid="devi"/> De opleveringsmail is <strong>niet</strong> verstuurd. Geen &lt;ontvanger&gt;. Zet Oplevermail daarna opnieuw op Verstuur nu.</body>',
    )
  })
})
