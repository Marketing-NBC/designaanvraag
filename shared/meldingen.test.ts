import { describe, expect, it } from 'vitest'
import type { Aanvraag } from './aanvraag-schema'
import { renderAanvullingMail, renderNieuweAanvraagMail, type NieuweAanvraagMail } from './meldingen'

const aanvraag = {
  naam: 'Britt', locatie: 'nbc', soort: 'evenement', event: 'Testevent', event_datum: '2026-11-20', deadline: '2026-11-13',
  aanvraag_types: ['torenscherm', 'vlaggen'], anders_tekst: '', design_modus: 'custom', website: 'https://www.nbcevents.nl',
  schijf_locatie: '', omschrijving: 'Graag in de huisstijl.',
} as unknown as Aanvraag

function nieuw(over: Partial<NieuweAanvraagMail> = {}) {
  return renderNieuweAanvraagMail({
    aanvraag, aanvraagId: 'abc-123', spoed: false, werkdagenTotEvent: 15,
    asanaUrl: 'https://app.asana.com/1/2/project/3', asanaFout: null, bijlagen: [], ...over,
  })
}

describe('melding bij een nieuwe aanvraag', () => {
  it('alleen de knop naar Asana, zonder losse link of aanvraagnummer eronder', () => {
    const { html } = nieuw()
    expect(html).toContain('Open de taak in Asana')
    expect(html.match(/https:\/\/app\.asana\.com\/1\/2\/project\/3/g)).toHaveLength(1)
    expect(html).not.toContain('abc-123')
  })

  it('zonder taak in Asana staat het aanvraagnummer er wel: dan is dat de enige weg terug', () => {
    expect(nieuw({ asanaUrl: null, asanaFout: 'Asana gaf 500' }).html).toContain('Aanvraag abc-123')
  })

  it('NBC in teal, Green Village in zijn eigen donkergroen met witte tekst', () => {
    expect(nieuw().html).toContain('bgcolor="#229d96"')
    const gv = nieuw({ aanvraag: { ...aanvraag, locatie: 'green_village' } }).html
    expect(gv).toContain('bgcolor="#23251b"')
    expect(gv).toMatch(/background:#23251b;color:#ffffff;/)
    expect(gv).not.toContain('#229d96')
    expect(gv).toContain('background:#f1f2ec')
  })
})

describe('melding bij een aanvulling', () => {
  it('kleurt mee met de locatie en heeft geen losse link onder de knop', () => {
    const { html } = renderAanvullingMail({
      naam: 'Britt', toelichting: 'Vlag erbij', link: '', schijfLocatie: '', extraTypes: [], andersTekst: '',
      aanvraag: {
        naam: 'Britt', locatie: 'green_village', soort: 'evenement', event: 'Testevent', omschrijving: '', spoed: false,
        eventDatum: '2026-11-20', deadline: '2026-11-13', eventDatumGewijzigd: false, deadlineGewijzigd: true, types: ['vlaggen'],
      },
      taakNaam: 'Testevent', asanaUrl: 'https://app.asana.com/x', bijgewerkt: [], bijlagen: [], heropend: false, asanaFout: null,
    })
    expect(html).toContain('bgcolor="#23251b"')
    expect(html.match(/https:\/\/app\.asana\.com\/x/g)).toHaveLength(1)
    expect(html).toContain('color:#5c6049;font-weight:bold;">(gewijzigd)')
  })
})
