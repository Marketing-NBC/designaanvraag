import { describe, expect, it } from 'vitest'
import { datumUitEventNaam, eventNaamBevatDatum, taskTitle } from './asana-title.ts'

const basis = {
  aanvraag_types: ['vlaggen', 'menu_scherm'] as const,
  anders_tekst: '',
  deadline: '2026-11-11',
  event: 'test evenement',
  event_datum: '2026-11-20',
  naam: 'Abel',
}

describe('taskTitle en de eventdatum', () => {
  it('zet de datum er niet nog een keer achter als hij al in de eventnaam staat', () => {
    expect(taskTitle({ ...basis, event: 'test evenement - 20 november 2026' } as never))
      .toBe('test evenement - 20 november 2026 - Abel - Deadline: 11 november - Meerdere designs')
  })

  it('zet de datum er wel achter als hij niet in de eventnaam staat', () => {
    expect(taskTitle(basis as never))
      .toBe('test evenement - 20 november - Abel - Deadline: 11 november - Meerdere designs')
  })
})

describe('eventNaamBevatDatum', () => {
  const ja = [
    'Zorgcongres 20 november 2026',
    'Zorgcongres 20 november',
    'Gala 20 nov',
    'Gala 20 Nov. 2026',
    'Gala 20nov',
    'Beurs 19-20 november',
    'Beurs 20-21 november',
    'Beurs 19 t/m 20 november',
    'Kick-off 20-11-2026',
    'Kick-off 20/11',
    'Kick-off 20.11.26',
    'Event 2026-11-20',
    'EY (20 november)',
  ]
  for (const naam of ja) it(`ja: ${naam}`, () => expect(eventNaamBevatDatum(naam, '2026-11-20')).toBe(true))

  const nee = [
    'Zorgcongres 2026',
    'Zorgcongres 21 november',
    'Gala 120 november',
    'Gala 20 december',
    'Event 20-12',
    'Event 2026-11-21',
    'Novembergala 20',
    'test evenement',
  ]
  for (const naam of nee) it(`nee: ${naam}`, () => expect(eventNaamBevatDatum(naam, '2026-11-20')).toBe(false))

  it('dag met voorloopnul', () => {
    expect(eventNaamBevatDatum('Event 05-03', '2026-03-05')).toBe(true)
    expect(eventNaamBevatDatum('Event 5 mrt', '2026-03-05')).toBe(true)
    expect(eventNaamBevatDatum('Event 5 maart', '2026-03-05')).toBe(true)
    expect(eventNaamBevatDatum('Event 15 maart', '2026-03-05')).toBe(false)
  })
})

describe('datumUitEventNaam', () => {
  const vandaag = '2026-11-03'
  const gevallen: [string, string | null][] = [
    ['Zorgcongres 20 november 2026', '2026-11-20'],
    ['Zorgcongres 20 november', '2026-11-20'],
    ['Gala 20 Nov. 2026', '2026-11-20'],
    ['Gala 20nov', '2026-11-20'],
    ['Beurs 19-20 november', '2026-11-19'],
    ['Beurs 19 t/m 20 november', '2026-11-19'],
    ['Kick-off 20-11-2026', '2026-11-20'],
    ['Kick-off 20/11', '2026-11-20'],
    ['Kick-off 20.11.26', '2026-11-20'],
    ['Event 2026-11-20', '2026-11-20'],
    ['EY (20 november)', '2026-11-20'],
    ['test evenement - 20 november 2026', '2026-11-20'],
    // Zonder jaartal en al geweest dit jaar: dan volgend jaar.
    ['Nieuwjaarsborrel 8 januari', '2027-01-08'],
    ['Lentefeest 5 mrt', '2027-03-05'],
    // Met jaartal en al geweest: niets kiezen, die datum kan niet.
    ['Gala 20 november 2025', null],
    ['Gala 1 november 2026', null],
    // Geen datum, of geen echte.
    ['Zorgcongres 2026', null],
    ['Gala 31 februari 2027', null],
    ['Borrel 20.30 uur', null],
    ['test evenement', null],
  ]
  for (const [naam, verwacht] of gevallen) {
    it(`${naam} → ${verwacht}`, () => expect(datumUitEventNaam(naam, vandaag)).toBe(verwacht))
  }

  it('wat hij vindt, telt ook als "datum staat al in de naam" voor de taaknaam', () => {
    for (const [naam, verwacht] of gevallen) {
      if (verwacht) expect(eventNaamBevatDatum(naam, verwacht)).toBe(true)
    }
  })
})
