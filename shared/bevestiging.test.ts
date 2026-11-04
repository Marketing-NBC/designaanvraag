import { describe, expect, it } from 'vitest'
import { aanvraagSchema } from './aanvraag-schema'
import { opsomming, renderBevestigingMail } from './bevestiging'

const aanvraag = aanvraagSchema.parse({
  naam: 'Britt',
  event: 'EY',
  event_datum: '2026-12-11',
  deadline: '2026-12-09',
  aanvraag_types: ['torenscherm'],
  design_modus: 'custom',
  omschrijving: 'Graag in de kleuren van EY',
})
const ID = '11111111-2222-4333-8444-555555555555'

describe('de bevestiging', () => {
  it('gaat naar de aanvrager, met een knop om aan te vullen', () => {
    const m = renderBevestigingMail({ aanvraag, aanvraagId: ID, aan: 'britt@nbcevents.nl', antwoordAan: 'marketing@nbcevents.nl' })
    expect(m.aan).toEqual(['britt@nbcevents.nl'])
    expect(m.antwoordAan).toEqual(['marketing@nbcevents.nl'])
    expect(m.onderwerp).toBe('Ontvangen: EY - 11 december - Torenscherm')
    expect(m.html).toContain(`?aanvullen=${ID}`)
    expect(m.html).toContain('Graag in de kleuren van EY')
    expect(m.html).not.toContain('gekoppeld')
  })

  it('noemt een Engels menu', () => {
    const m = renderBevestigingMail({
      aanvraag: { ...aanvraag, menu_taal: 'en' }, aanvraagId: ID, aan: 'britt@nbcevents.nl', antwoordAan: 'marketing@nbcevents.nl', menuPakket: 'Grab & Go',
    })
    expect(m.html).toContain('Grab &amp; Go, in het Engels')
  })
})

describe('opsomming', () => {
  it('schrijft namen als een zin', () => {
    expect(opsomming([])).toBe('')
    expect(opsomming(['Bo'])).toBe('Bo')
    expect(opsomming(['Bo', 'Karen'])).toBe('Bo en Karen')
    expect(opsomming(['Bo', 'Karen', 'Britt'])).toBe('Bo, Karen en Britt')
  })
})
