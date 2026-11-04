import { describe, expect, it } from 'vitest'
import { herinneringVandaag, isWerkdag, renderAkkoordMelding, renderHerinneringMail, verslagAkkoord, type OpenOplevering } from './akkoord'

describe('werkdagen', () => {
  it('maandag tot en met vrijdag', () => {
    expect(isWerkdag('2026-11-02')).toBe(true) // maandag
    expect(isWerkdag('2026-11-06')).toBe(true) // vrijdag
    expect(isWerkdag('2026-11-07')).toBe(false) // zaterdag
    expect(isWerkdag('2026-11-08')).toBe(false) // zondag
  })
})

describe('wie krijgt vandaag een herinnering', () => {
  // Verstuurd op dinsdag 3 november om 14:00 Nederlandse tijd.
  const basis: OpenOplevering = {
    verstuurd_op: '2026-11-03T13:00:00Z', herinneren: true, akkoord_op: null, feedback_op: null, gestopt_op: null, laatste_herinnering: null,
  }

  it('niet op de dag zelf, wel de werkdag erna', () => {
    expect(herinneringVandaag(basis, '2026-11-03')).toBe(false)
    expect(herinneringVandaag(basis, '2026-11-04')).toBe(true)
  })

  it('niet in het weekend', () => {
    expect(herinneringVandaag(basis, '2026-11-07')).toBe(false)
    expect(herinneringVandaag(basis, '2026-11-09')).toBe(true)
  })

  it('één keer per dag, ook als de workflow twee keer draait', () => {
    expect(herinneringVandaag({ ...basis, laatste_herinnering: '2026-11-04T08:00:00Z' }, '2026-11-04')).toBe(false)
    expect(herinneringVandaag({ ...basis, laatste_herinnering: '2026-11-04T08:00:00Z' }, '2026-11-05')).toBe(true)
  })

  it('stopt bij akkoord, feedback, of als Marketing hem stopte', () => {
    expect(herinneringVandaag({ ...basis, akkoord_op: '2026-11-04T10:00:00Z' }, '2026-11-05')).toBe(false)
    expect(herinneringVandaag({ ...basis, feedback_op: '2026-11-04T10:00:00Z' }, '2026-11-05')).toBe(false)
    expect(herinneringVandaag({ ...basis, gestopt_op: '2026-11-04T10:00:00Z' }, '2026-11-05')).toBe(false)
  })

  it('niet voor opleveringen van voor het akkoord bestond', () => {
    expect(herinneringVandaag({ ...basis, herinneren: false }, '2026-11-04')).toBe(false)
  })
})

describe('de mails', () => {
  const waarover = { soort: 'evenement' as const, event: 'EY', eventDatum: '2026-12-11', omschrijving: '', types: ['torenscherm' as const], andersTekst: '' }

  it('de herinnering heeft een akkoordknop en een feedbackknop', () => {
    const m = renderHerinneringMail({
      ...waarover, aan: ['britt@nbcevents.nl'], antwoordAan: ['marketing@nbcevents.nl'], aanvraagId: '11111111-2222-4333-8444-555555555555',
      locatie: 'nbc', versie: 2, verstuurdOp: '2026-11-03T13:00:00Z', nummer: 1,
    })
    expect(m.onderwerp).toMatch(/^Herinnering: wacht op je akkoord - EY/)
    expect(m.html).toContain('?akkoord=11111111-2222-4333-8444-555555555555')
    expect(m.html).toContain('?feedback=11111111-2222-4333-8444-555555555555')
    expect(m.html).toContain('Versie 2')
    // Feedback eerst, akkoord eronder in Goudgeel met zwarte tekst.
    expect(m.html.indexOf('Feedback geven')).toBeLessThan(m.html.indexOf('Akkoord geven'))
    expect(m.html).toContain('background:#f6a304')
  })

  it('bij Green Village is de akkoordknop Orange Roughy', () => {
    const m = renderHerinneringMail({
      ...waarover, aan: ['bo@green-village.nl'], antwoordAan: ['marketing@green-village.nl'], aanvraagId: '11111111-2222-4333-8444-555555555555',
      locatie: 'green_village', versie: 1, verstuurdOp: '2026-11-03T13:00:00Z', nummer: 1,
    })
    expect(m.html).toContain('background:#833113')
    expect(m.html).not.toContain('#f6a304')
  })

  it('Marketing hoort wie akkoord gaf, en of Asana het niet bijwerkte', () => {
    const goed = renderAkkoordMelding({ ...waarover, aan: 'marketing@nbcevents.nl', locatie: 'nbc', door: 'Britt', versie: 1, asanaUrl: 'https://app.asana.com/x', asanaFout: null })
    expect(goed.onderwerp).toBe('Akkoord: EY - 11 december - Torenscherm')
    expect(goed.html).toContain('Afgerond')
    const fout = renderAkkoordMelding({ ...waarover, aan: 'marketing@nbcevents.nl', locatie: 'nbc', door: 'Britt', versie: 1, asanaUrl: null, asanaFout: 'kapot' })
    expect(fout.html).toContain('Niet bijgewerkt in Asana')
  })

  it('de reactie in Asana noemt wie, welke versie en wanneer', () => {
    const r = verslagAkkoord({ door: 'Britt <b>', versie: 2, datum: '2026-11-04', afgerond: true })
    expect(r).toContain('Britt &lt;b&gt;')
    expect(r).toContain('versie 2')
    expect(r).toContain('Afgerond')
  })
})
