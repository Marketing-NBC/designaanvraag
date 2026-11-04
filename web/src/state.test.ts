import { describe, expect, it } from 'vitest'
import { emptyDraft, eventDatumUitNaam, metEventNaam, naamUitLijst, type Draft } from './state'

const vandaag = '2026-11-03'
const d = (over: Partial<Draft> = {}): Draft => ({ ...emptyDraft(), ...over })

/** Typt de naam letter voor letter, zoals in het formulier. */
function typ(start: Draft, naam: string): Draft {
  let draft = start
  for (let i = 1; i <= naam.length; i++) draft = { ...draft, ...metEventNaam(draft, naam.slice(0, i), vandaag) }
  return draft
}

describe('eventdatum uit de eventnaam', () => {
  it('klikt de datum uit de naam alvast aan', () => {
    const draft = typ(d(), 'test evenement - 20 november 2026')
    expect(draft.event_datum).toBe('2026-11-20')
    expect(eventDatumUitNaam(draft, vandaag)).toBe(true)
  })

  it('zonder datum in de naam blijft hij leeg', () => {
    expect(typ(d(), 'Zorgcongres 2026').event_datum).toBeNull()
  })

  it('een zelf gekozen andere dag blijft staan als de naam verandert', () => {
    const draft = typ(d({ event_datum: '2026-11-21' }), 'Gala 20 november')
    expect(draft.event_datum).toBe('2026-11-21')
    expect(eventDatumUitNaam(draft, vandaag)).toBe(false)
  })

  it('past de naam aan, dan gaat de aangeklikte dag mee', () => {
    let draft = typ(d(), 'Gala 20 november')
    draft = { ...draft, ...metEventNaam(draft, 'Gala 27 november', vandaag) }
    expect(draft.event_datum).toBe('2026-11-27')
    draft = { ...draft, ...metEventNaam(draft, 'Gala', vandaag) }
    expect(draft.event_datum).toBeNull()
  })

  it('een deadline na de nieuwe eventdatum vervalt', () => {
    const draft = { ...d({ deadline: '2026-11-25' }), ...metEventNaam(d({ deadline: '2026-11-25' }), 'Gala 20 november', vandaag) }
    expect(draft.deadline).toBeNull()
    const ervoor = { ...d({ deadline: '2026-11-10' }), ...metEventNaam(d({ deadline: '2026-11-10' }), 'Gala 20 november', vandaag) }
    expect(ervoor.deadline).toBe('2026-11-10')
  })
})

describe('naam uit de lijst', () => {
  it('vindt de naam, hoofdletters en spaties daargelaten', () => {
    expect(naamUitLijst(' britt ', ['Britt', 'Karen'])).toBe('Britt')
    expect(naamUitLijst('Jan Nieuwkomer', ['Britt', 'Karen'])).toBeNull()
  })
})
