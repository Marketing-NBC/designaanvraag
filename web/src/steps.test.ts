import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPOED_WERKDAGEN } from '../../shared/spoed'
import { moetContactOpnemen, STEPS, zichtbareStappen } from './steps'
import type { RequestTypeKey } from '../../shared/request-types'
import { gerechtVan, leegMenu, uitPakket } from './lib/menu'
import { alleenTeKiezenTypes, emptyDraft, type Draft } from './state'

const eventStap = STEPS.find((s) => s.id === 'event_datum')!

function draft(event_datum: string): Draft {
  return { ...emptyDraft(), event_datum }
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

  it('complimenteert niet bij een spoedje, maar waarschuwt voor drukwerk', () => {
    // Vrijdag 16 oktober: negen werkdagen, minder dan twee weken.
    expect(eventStap.goed?.(draft('2026-10-16'))).toBeNull()
    expect(eventStap.warn?.(draft('2026-10-16'))).toContain('Drukwerk')
    expect(eventStap.alarm?.(draft('2026-10-16'))).toBeNull()
  })

  it('vraagt binnen drie werkdagen om contact met Marketing', () => {
    // Donderdag 8 oktober: drie werkdagen (ma, di, wo).
    expect(eventStap.alarm?.(draft('2026-10-08'))).toContain('contact')
    expect(eventStap.warn?.(draft('2026-10-08'))).toBeNull()
    // Vrijdag 9 oktober: vier werkdagen, dan alleen de drukwerkwaarschuwing.
    expect(eventStap.alarm?.(draft('2026-10-09'))).toBeNull()
    expect(eventStap.warn?.(draft('2026-10-09'))).toContain('Drukwerk')
  })

  it('waarschuwt niet als het ruim op tijd is', () => {
    expect(eventStap.warn?.(draft('2026-10-19'))).toBeNull()
    expect(eventStap.alarm?.(draft('2026-10-19'))).toBeNull()
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

describe('volgorde van de vragen', () => {
  it('vraagt standaard of custom direct na de deadline, vóór wat je wilt aanvragen', () => {
    const ids = zichtbareStappen({ metMenu: false, soort: 'evenement' }).map((s) => s.id)
    expect(ids[ids.indexOf('deadline') + 1]).toBe('design_modus')
    expect(ids.indexOf('design_modus')).toBeLessThan(ids.indexOf('aanvraag_types'))
  })
})

describe('designkeuze en aanvraagtypes', () => {
  it('gooit bij standaard designs weg wat daar niet te kiezen is', () => {
    const d = { ...emptyDraft(), locatie: 'nbc' as const, aanvraag_types: ['led_kolom', 'vlaggen', 'anders'] as RequestTypeKey[], anders_tekst: 'Roll-up' }
    const uit = alleenTeKiezenTypes({ ...d, design_modus: 'standaard' })
    expect(uit.aanvraag_types).toEqual(['led_kolom'])
    expect(uit.anders_tekst).toBe('')
    expect(alleenTeKiezenTypes({ ...d, design_modus: 'custom' }).aanvraag_types).toEqual(d.aanvraag_types)
  })
})

describe('de vraag over het menu', () => {
  // Deze stap hoort er alleen te zijn als er ook echt een menu gemaakt wordt.
  const menuStap = STEPS.find((s) => s.id === 'menu')!

  function metTypes(types: RequestTypeKey[], menu = leegMenu()): Draft {
    return { ...draft('2026-12-01'), aanvraag_types: types, menu }
  }

  it('staat niet in de stappen zonder menu-aanvraag', () => {
    const ids = zichtbareStappen({ metMenu: false, soort: 'evenement' }).map((s) => s.id)
    expect(ids).not.toContain('menu')
  })

  it('komt erbij zodra er een menuscherm is gekozen', () => {
    const ids = zichtbareStappen({ metMenu: true, soort: 'evenement' }).map((s) => s.id)
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
    menu.secties[0].gerechten.push(gerechtVan('Broodje kaantjes | appelstroop'))
    expect(menuStap.validate(metTypes(['menu_scherm'], menu))).toBeNull()
    expect(menuStap.warn?.(metTypes(['menu_scherm'], menu))).toContain('staat niet in de gerechtenlijst')
    expect(menuStap.warn?.(metTypes(['menu_scherm'], uitPakket('lunch-basic')))).toBeNull()
  })

  it('blokkeert niets als er geen menu bij hoort', () => {
    expect(menuStap.validate(metTypes(['vlaggen']))).toBeNull()
  })
})

describe('evenement of intern', () => {
  it('vraagt het meteen na de naam', () => {
    const ids = zichtbareStappen({ metMenu: false, soort: null }).map((s) => s.id)
    expect(ids.slice(0, 3)).toEqual(['locatie', 'naam', 'soort'])
  })

  it('telt de vragen van een evenement zolang er niet gekozen is', () => {
    expect(zichtbareStappen({ metMenu: false, soort: null })).toEqual(zichtbareStappen({ metMenu: false, soort: 'evenement' }))
  })

  it('intern: alleen wat je wilt en wanneer', () => {
    const ids = zichtbareStappen({ metMenu: false, soort: 'intern' }).map((s) => s.id)
    expect(ids).toEqual(['locatie', 'naam', 'soort', 'wens_intern', 'deadline_intern'])
  })

  it('intern: ook een eerder gekozen menu brengt de menuvraag niet terug', () => {
    expect(zichtbareStappen({ metMenu: true, soort: 'intern' }).map((s) => s.id)).not.toContain('menu')
  })

  it('intern: een datum, of "Geen deadline"', () => {
    const stap = zichtbareStappen({ metMenu: false, soort: 'intern' }).find((s) => s.id === 'deadline_intern')!
    expect(stap.validate({ ...emptyDraft(), soort: 'intern' })).toMatch(/Geen deadline/)
    expect(stap.validate({ ...emptyDraft(), soort: 'intern', geen_deadline: true })).toBeNull()
    expect(stap.validate({ ...emptyDraft(), soort: 'intern', deadline: '2099-01-01' })).toBeNull()
  })

  it('wil een omschrijving bij een interne aanvraag', () => {
    const stap = STEPS.find((s) => s.id === 'wens_intern')!
    expect(stap.validate({ ...emptyDraft(), soort: 'intern' })).toContain('Beschrijf')
    expect(stap.validate({ ...emptyDraft(), soort: 'intern', omschrijving: 'Nieuwe visitekaartjes' })).toBeNull()
  })
})

describe('je naam', () => {
  const naamStap = STEPS.find((s) => s.id === 'naam')!

  it('mag ook een naam zijn die niet in de lijst staat', () => {
    expect(naamStap.validate({ ...emptyDraft(), naam: 'Iemand Nieuw' })).toBeNull()
  })

  it('moet wel ingevuld zijn', () => {
    expect(naamStap.validate({ ...emptyDraft(), naam: '  ' })).toContain('Vul je naam in')
  })
})

describe('de deadline', () => {
  const deadlineStap = STEPS.find((s) => s.id === 'deadline')!
  const typesStap = STEPS.find((s) => s.id === 'aanvraag_types')!
  const metDeadline = (deadline: string, types: RequestTypeKey[] = []): Draft => ({
    ...emptyDraft(), event_datum: '2026-12-01', deadline, aanvraag_types: types,
  })

  // Maandag 5 oktober 2026.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00+02:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('vier werkdagen: een zachte waarschuwing', () => {
    // Vrijdag 9 oktober.
    expect(deadlineStap.warn?.(metDeadline('2026-10-09'))).toContain('dit zijn er 4')
    expect(deadlineStap.alarm?.(metDeadline('2026-10-09'))).toBeNull()
  })

  it('één werkdag: "dit is er 1", en contact opnemen', () => {
    // Dinsdag 6 oktober.
    const tekst = deadlineStap.alarm?.(metDeadline('2026-10-06'))
    expect(tekst).toContain('dit is er 1.')
    expect(tekst).toContain('contact')
    expect(deadlineStap.warn?.(metDeadline('2026-10-06'))).toBeNull()
    expect(moetContactOpnemen(metDeadline('2026-10-06'))).toBe(true)
  })

  it('ruim op tijd: niets', () => {
    expect(deadlineStap.warn?.(metDeadline('2026-10-20'))).toBeNull()
    expect(deadlineStap.alarm?.(metDeadline('2026-10-20'))).toBeNull()
    expect(moetContactOpnemen(metDeadline('2026-10-20'))).toBe(false)
  })

  it('menukaart print binnen twee weken: geen garantie', () => {
    expect(typesStap.warn?.(metDeadline('2026-10-16', ['menukaart_print']))).toContain('niet garanderen')
    expect(typesStap.warn?.(metDeadline('2026-10-19', ['menukaart_print']))).toBeNull()
    expect(typesStap.warn?.(metDeadline('2026-10-16', ['menu_scherm']))).toBeNull()
  })
})
