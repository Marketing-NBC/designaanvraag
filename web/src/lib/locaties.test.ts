import { describe, expect, it } from 'vitest'
import {
  LOCATIES, REQUEST_TYPES, designModesVoor, requestTypesVoor, typeHoortBij,
} from '../../../shared/request-types'

describe('wat er per locatie te kiezen valt', () => {
  it('toont bij NBC alles, in de volgorde van de lijst', () => {
    expect(requestTypesVoor('nbc').map((t) => t.key)).toEqual(REQUEST_TYPES.map((t) => t.key))
  })

  it('laat bij Green Village de LED-kolom weg', () => {
    const keys = requestTypesVoor('green_village').map((t) => t.key)
    expect(keys).not.toContain('led_kolom')
    expect(keys).toEqual([
      'torenscherm', 'overige_schermen', 'menukaart_print',
      'menu_scherm', 'koffiescherm', 'vlaggen', 'anders',
    ])
  })

  it('valt zonder keuze terug op NBC, zodat het scherm nooit leeg is', () => {
    expect(requestTypesVoor(null).map((t) => t.key)).toEqual(requestTypesVoor('nbc').map((t) => t.key))
  })

  it('kent elke locatie een lijst toe die alleen bestaande types bevat', () => {
    const bekend = new Set(REQUEST_TYPES.map((t) => t.key))
    for (const l of LOCATIES) {
      const types = requestTypesVoor(l.key)
      expect(types.length).toBeGreaterThan(0)
      for (const t of types) expect(bekend.has(t.key)).toBe(true)
    }
  })

  it('zegt per type of het bij een locatie hoort', () => {
    expect(typeHoortBij('nbc', 'led_kolom')).toBe(true)
    expect(typeHoortBij('green_village', 'led_kolom')).toBe(false)
    expect(typeHoortBij('green_village', 'torenscherm')).toBe(true)
  })

  it('toont bij standaard designs alleen de vaste templates', () => {
    expect(requestTypesVoor('nbc', 'standaard').map((t) => t.key)).toEqual(['led_kolom', 'torenscherm', 'menu_scherm'])
    // Green Village heeft geen LED-kolom, ook niet als standaard design.
    expect(requestTypesVoor('green_village', 'standaard').map((t) => t.key)).toEqual(['torenscherm', 'menu_scherm'])
    expect(requestTypesVoor('nbc', 'standaard')[0].description).toBe('Standaarden van NBC met logo')
  })

  it('laat bij custom alles staan, zonder uitleg eronder', () => {
    expect(requestTypesVoor('nbc', 'custom').map((t) => t.key)).toEqual(REQUEST_TYPES.map((t) => t.key))
    expect(requestTypesVoor('nbc', 'custom').some((t) => t.description)).toBe(false)
  })

  it('zegt per type of het bij standaard designs hoort', () => {
    expect(typeHoortBij('nbc', 'vlaggen', 'standaard')).toBe(false)
    expect(typeHoortBij('nbc', 'vlaggen', 'custom')).toBe(true)
    expect(typeHoortBij('green_village', 'led_kolom', 'standaard')).toBe(false)
    expect(typeHoortBij('green_village', 'menu_scherm', 'standaard')).toBe(true)
  })

  it('noemt de locatie in de omschrijving van de standaard designs', () => {
    // Abel: "als er ergens NBC staat moet dat Green Village zijn, als ze dat hebben gekozen."
    const nbc = designModesVoor('nbc').find((m) => m.key === 'standaard')!
    const gv = designModesVoor('green_village').find((m) => m.key === 'standaard')!
    expect(nbc.description).toContain('NBC')
    expect(gv.description).toContain('Green Village')
    expect(gv.description).not.toMatch(/\bNBC\b/)
    // En er blijft nooit een onvervangen plaatshouder staan.
    for (const l of [...LOCATIES.map((l) => l.key), null]) {
      for (const m of designModesVoor(l)) expect(m.description).not.toContain('{locatie}')
    }
  })
})
