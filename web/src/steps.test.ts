import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPOED_WERKDAGEN } from '../../shared/spoed'
import { STEPS } from './steps'
import type { Draft } from './state'

const eventStap = STEPS.find((s) => s.id === 'event_datum')!

function draft(event_datum: string): Draft {
  return { naam: '', event: '', event_datum, deadline: '', website: '', schijf_locatie: '', bijlagen: [], aanvraag_types: [], anders_tekst: '', design_modus: null, omschrijving: '' } as Draft
}

describe('bevestiging op de eventdatum', () => {
  // Maandag 5 oktober 2026, middenop de dag zodat de tijdzone niets verschuift.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00+02:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('zegt niets zonder datum', () => {
    expect(eventStap.goed?.(draft(''))).toBeNull()
  })

  it('zegt niets bij een spoedje', () => {
    // Vrijdag 16 oktober: negen werkdagen, dus krap. Daar waarschuwen we bewust niet over.
    expect(eventStap.goed?.(draft('2026-10-16'))).toBeNull()
  })

  it('complimenteert vanaf precies tien werkdagen', () => {
    // Maandag 19 oktober: tien werkdagen, de eerste dag die geen spoedje meer is.
    const tekst = eventStap.goed?.(draft('2026-10-19'))
    expect(tekst).toContain(`${SPOED_WERKDAGEN} werkdagen`)
  })

  it('complimenteert ruim van tevoren', () => {
    expect(eventStap.goed?.(draft('2026-12-01'))).toContain('op tijd')
  })

  it('zegt niets over een datum die al geweest is', () => {
    expect(eventStap.goed?.(draft('2026-09-01'))).toBeNull()
  })
})
