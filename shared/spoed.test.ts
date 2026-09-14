import { describe, expect, it } from 'vitest'
import { addDays, differenceInBusinessDays, format } from 'date-fns'
import { isSpoed, SPOED_WERKDAGEN, vandaagInNl, werkdagenTotEvent, werkdagenTussen } from './spoed'

// Maandag 14 september 2026.
const MA = '2026-09-14'

describe('werkdagenTussen', () => {
  it('telt de startdag mee en de einddag niet: hoeveel werkdagen heb je nog', () => {
    expect(werkdagenTussen(MA, MA)).toBe(0)
    expect(werkdagenTussen(MA, '2026-09-15')).toBe(1)
    expect(werkdagenTussen(MA, '2026-09-18')).toBe(4) // vrijdag
  })

  it('slaat het weekend over', () => {
    expect(werkdagenTussen(MA, '2026-09-19')).toBe(5) // zaterdag: de hele werkweek zit ervoor
    expect(werkdagenTussen(MA, '2026-09-20')).toBe(5) // zondag idem
    expect(werkdagenTussen(MA, '2026-09-21')).toBe(5) // volgende maandag
  })

  it('is negatief voor een datum in het verleden', () => {
    expect(werkdagenTussen(MA, '2026-09-11')).toBe(-1)
    expect(werkdagenTussen(MA, '2026-09-07')).toBe(-5)
  })

  it('rekent hetzelfde als date-fns, over een heel jaar', () => {
    const start = new Date(2026, 8, 14)
    for (let i = 0; i < 365; i++) {
      const tot = addDays(start, i)
      expect(werkdagenTussen(MA, format(tot, 'yyyy-MM-dd'))).toBe(differenceInBusinessDays(tot, start))
    }
  })

  it('geeft NaN bij onzin', () => {
    expect(werkdagenTussen('geen datum', MA)).toBeNaN()
  })
})

describe('isSpoed', () => {
  it('precies 10 werkdagen is nog geen spoed', () => {
    // Maandag + 10 werkdagen = de maandag twee weken later.
    expect(werkdagenTotEvent('2026-09-28', MA)).toBe(SPOED_WERKDAGEN)
    expect(isSpoed('2026-09-28', MA)).toBe(false)
  })

  it('9 werkdagen is wel spoed', () => {
    expect(werkdagenTotEvent('2026-09-25', MA)).toBe(9)
    expect(isSpoed('2026-09-25', MA)).toBe(true)
  })

  it('een event vandaag of morgen is spoed', () => {
    expect(isSpoed(MA, MA)).toBe(true)
    expect(isSpoed('2026-09-15', MA)).toBe(true)
  })

  it('een event ver weg is geen spoed', () => {
    expect(isSpoed('2026-12-01', MA)).toBe(false)
  })

  it('een onbruikbare datum is geen spoed', () => {
    expect(isSpoed('geen datum', MA)).toBe(false)
  })
})

describe('vandaagInNl', () => {
  it('geeft de Nederlandse datum, ook net na middernacht in Amsterdam', () => {
    // 23:30 UTC op 14 september is in Amsterdam al 15 september (zomertijd, UTC+2).
    expect(vandaagInNl(new Date('2026-09-14T23:30:00Z'))).toBe('2026-09-15')
    expect(vandaagInNl(new Date('2026-09-14T10:00:00Z'))).toBe('2026-09-14')
  })
})
