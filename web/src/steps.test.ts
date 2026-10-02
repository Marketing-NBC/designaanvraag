import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPOED_WERKDAGEN } from '../../shared/spoed'
import { STEPS, zichtbareStappen } from './steps'
import type { RequestTypeKey } from '../../shared/request-types'
import { leegMenu, uitPakket } from './lib/menu'
import type { Draft } from './state'

const eventStap = STEPS.find((s) => s.id === 'event_datum')!

function draft(event_datum: string): Draft {
  return { naam: '', event: '', event_datum, deadline: '', website: '', schijf_locatie: '', bijlagen: [], aanvraag_types: [], anders_tekst: '', design_modus: null, menu: leegMenu(), omschrijving: '' } as Draft
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

describe('de vraag over het menu', () => {
  // Deze stap hoort er alleen te zijn als er ook echt een menu gemaakt wordt.
  const menuStap = STEPS.find((s) => s.id === 'menu')!

  function metTypes(types: RequestTypeKey[], menu = leegMenu()): Draft {
    return { ...draft('2026-12-01'), aanvraag_types: types, menu }
  }

  it('staat niet in de stappen zonder menu-aanvraag', () => {
    const ids = zichtbareStappen({ metMenu: false }).map((s) => s.id)
    expect(ids).not.toContain('menu')
  })

  it('komt erbij zodra er een menuscherm is gekozen', () => {
    const ids = zichtbareStappen({ metMenu: true }).map((s) => s.id)
    expect(ids).toContain('menu')
    // Meteen na de vraag wat je wilt aanvragen, want het hoort bij die keuze.
    expect(ids[ids.indexOf('menu') - 1]).toBe('aanvraag_types')
  })

  it('vraagt om een pakket zodra de stap er is', () => {
    expect(menuStap.validate(metTypes(['menu_scherm']))).toContain('Kies een pakket')
    expect(menuStap.validate(metTypes(['menu_scherm'], uitPakket('lunch-basic')))).toBeNull()
  })

  it('laat een leeggehaald menu niet door', () => {
    const leeg = uitPakket('lunch-basic')
    for (const s of leeg.secties) s.gerechten = []
    expect(menuStap.validate(metTypes(['menu_scherm'], leeg))).toContain('geen enkel gerecht')
  })

  it('waarschuwt over een gerecht buiten de lijst, maar blokkeert niet', () => {
    const menu = uitPakket('lunch-basic')
    menu.secties[0].gerechten.push('Broodje kaantjes | appelstroop')
    expect(menuStap.validate(metTypes(['menu_scherm'], menu))).toBeNull()
    expect(menuStap.warn?.(metTypes(['menu_scherm'], menu))).toContain('staat niet in de gerechtenlijst')
    expect(menuStap.warn?.(metTypes(['menu_scherm'], uitPakket('lunch-basic')))).toBeNull()
  })

  it('blokkeert niets als er geen menu bij hoort', () => {
    expect(menuStap.validate(metTypes(['vlaggen']))).toBeNull()
  })
})
