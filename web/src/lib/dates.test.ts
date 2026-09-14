import { describe, expect, it } from 'vitest'
import { businessDaysUntil, earliestComfortableDeadline, formatLong, isBeforeToday, todayIso } from './dates'

// Maandag 14 september 2026
const MON = new Date(2026, 8, 14, 10, 0, 0)

describe('dates', () => {
  it('todayIso in lokale tijd', () => {
    expect(todayIso(MON)).toBe('2026-09-14')
  })
  it('telt werkdagen tot de deadline', () => {
    expect(businessDaysUntil('2026-09-14', MON)).toBe(0)
    expect(businessDaysUntil('2026-09-18', MON)).toBe(4) // vrijdag
    expect(businessDaysUntil('2026-09-21', MON)).toBe(5) // volgende maandag
    expect(businessDaysUntil('2026-09-11', MON)).toBeLessThan(0)
  })
  it('vroegste comfortabele deadline is 5 werkdagen verder', () => {
    expect(earliestComfortableDeadline(5, MON)).toBe('2026-09-21')
  })
  it('formatteert in het Nederlands', () => {
    expect(formatLong('2026-09-14')).toBe('maandag 14 september 2026')
  })
  it('herkent datums in het verleden', () => {
    expect(isBeforeToday('2026-09-13', MON)).toBe(true)
    expect(isBeforeToday('2026-09-14', MON)).toBe(false)
  })
})
