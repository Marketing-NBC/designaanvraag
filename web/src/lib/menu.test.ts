import { describe, expect, it } from 'vitest'
import {
  PAKKETGROEPEN, PAKKETTEN, PAKKETTEN_OP_SCHERM, ALLE_GERECHTEN, aantalGerechten,
  eigenGerechten, gerechtenInPakket, isBekend, letterVoorPakket, naarInhoud, naarTekst,
  pakketVan, regelVan, sectiesVan, uitPakket, wijzigingen,
} from './menu'

describe('de pakketten voor het formulier', () => {
  it('kent de negen pakketten met een naam die de aanvrager herkent', () => {
    expect(PAKKETTEN).toHaveLength(9)
    expect(PAKKETTEN.map((p) => p.naam)).toContain('Standard Lunch')
    expect(PAKKETTEN.map((p) => p.naam)).toContain('Walking dinner')
    for (const p of PAKKETTEN) expect(p.secties.length).toBeGreaterThan(0)
  })

  it('zet een gerecht op één regel, zoals het op het scherm komt', () => {
    expect(regelVan({ naam: 'Witte sesambol', ingredienten: ['achterham', 'tomaat'] }))
      .toBe('Witte sesambol | achterham | tomaat')
    // Een gerecht zonder ingredienten blijft gewoon zijn naam.
    expect(regelVan({ naam: 'Fruitsalade' })).toBe('Fruitsalade')
  })

  it('vult het menu met alles wat er in het pakket zit', () => {
    const menu = uitPakket('lunch-basic')
    const pakket = pakketVan('lunch-basic')!
    expect(menu.pakket).toBe('lunch-basic')
    expect(aantalGerechten(menu)).toBe(
      pakket.secties.reduce((n, s) => n + s.gerechten.length, 0))
    expect(menu.secties[0].gerechten[0]).toMatch(/^Volkorenpunt \| belegen kaas/)
  })

  it('herkent wat uit de lijst komt en wat iemand zelf typte', () => {
    const menu = uitPakket('lunch-basic')
    expect(eigenGerechten(menu)).toEqual([])
    menu.secties[0].gerechten.push('Broodje kaantjes | appelstroop')
    expect(eigenGerechten(menu)).toEqual(['Broodje kaantjes | appelstroop'])
    expect(isBekend(menu.secties[0].gerechten[0])).toBe(true)
  })

  it('schrijft op wat er van het pakket afwijkt', () => {
    const menu = uitPakket('lunch-basic')
    const weg = menu.secties[0].gerechten[1]
    menu.secties[0].gerechten.splice(1, 1)
    menu.secties[0].gerechten.push('Broodje kaantjes | appelstroop')

    const uit = wijzigingen(menu)
    expect(uit).toContain(`Broodjes: ${weg} gaat eruit`)
    expect(uit.some((r) => r.includes('staat niet in de gerechtenlijst'))).toBe(true)
    // Zonder wijzigingen valt er niets te melden.
    expect(wijzigingen(uitPakket('lunch-basic'))).toEqual([])
  })

  it('maakt de invulling in de vorm die de opmaak-engine leest', () => {
    const tekst = naarTekst(uitPakket('lunch-basic'))
    const regels = tekst.split('\n')
    expect(regels[0]).toBe('Broodjes')
    expect(regels[1]).toMatch(/^• Volkorenpunt \| belegen kaas/)
    expect(tekst).toContain('Warme items')
    // Een leeg onderdeel hoort er niet in te staan.
    const leeg = uitPakket('lunch-basic')
    leeg.secties[1].gerechten = []
    expect(naarTekst(leeg)).not.toContain('Warme items')
  })

  it('geeft het menu als structuur door, met de opsomming intact', () => {
    // De Tartelettes van Grab & Go zijn een kopje met gerechten eronder. Door platte
    // tekst overleeft dat niet, dus moet het als structuur mee.
    const inhoud = naarInhoud(uitPakket('grab-and-go'))!
    const tartelettes = inhoud.secties.flatMap((s) => s.gerechten)
      .find((g) => g.naam === 'Tartelettes') as { onderdelen?: unknown[] } | undefined
    expect(tartelettes?.onderdelen).toHaveLength(2)
  })

  it('maakt van een zelf getypt gerecht een naam met ingredienten', () => {
    const menu = uitPakket('lunch-basic')
    menu.secties[0].gerechten.push('Broodje kaantjes | appelstroop | bosui')
    const inhoud = naarInhoud(menu)!
    const eigen = inhoud.secties[0].gerechten.at(-1)!
    expect(eigen.naam).toBe('Broodje kaantjes')
    expect((eigen as { ingredienten?: string[] }).ingredienten).toEqual(['appelstroop', 'bosui'])
    // En een leeg onderdeel hoort er niet in te staan.
    menu.secties[1].gerechten = []
    expect(naarInhoud(menu)!.secties).toHaveLength(1)
  })

  it('biedt elk gerecht uit elk pakket aan om mee te wisselen', () => {
    const bekend = new Set(ALLE_GERECHTEN.map(regelVan))
    for (const p of PAKKETTEN) {
      for (const s of p.secties) {
        for (const g of s.gerechten) expect(bekend.has(regelVan(g))).toBe(true)
      }
    }
    expect(ALLE_GERECHTEN.length).toBeGreaterThan(50)
  })
})

describe('de pakketten op het scherm', () => {
  it('zet elk pakket in precies één groep', () => {
    const gegroepeerd = PAKKETGROEPEN.flatMap((g) => g.pakketten)
    expect(new Set(gegroepeerd).size).toBe(gegroepeerd.length)
    // Niets mag ontbreken: een pakket dat nergens staat kan niemand kiezen.
    expect([...gegroepeerd].sort()).toEqual(PAKKETTEN.map((p) => p.pakket).sort())
  })

  it('laat de lettertoets wijzen naar de rij die je ziet', () => {
    // De letters lopen door over de groepen heen. Zou dit van PAKKETTEN afgeleid
    // worden in plaats van van de groepen, dan kiest toets A een ander pakket dan er
    // bovenaan het scherm staat.
    expect(PAKKETTEN_OP_SCHERM).toHaveLength(PAKKETTEN.length)
    expect(PAKKETTEN_OP_SCHERM[0].naam).toBe('Basic Lunch')
    PAKKETTEN_OP_SCHERM.forEach((p, i) => {
      expect(letterVoorPakket(p.pakket)).toBe(i)
    })
    expect(letterVoorPakket('bestaat-niet')).toBeNull()
  })

  it('vat de gangen samen in één regel, met een telling voor de rest', () => {
    const lunch = pakketVan('lunch-basic')!
    expect(sectiesVan(lunch)).toEqual({ tekst: 'Broodjes · Warme items', meer: 0 })

    // Standard Lunch heeft zes gangen; drie op de regel en de rest als "+3".
    const standaard = sectiesVan(pakketVan('lunch-standaard')!)
    expect(standaard.tekst.split(' · ')).toHaveLength(3)
    expect(standaard.meer).toBe(3)

    // De lange kop uit het ontwerp wordt ingekort, anders vult die de hele regel.
    expect(sectiesVan(pakketVan('grab-and-go')!).tekst).toMatch(/^Op tafel/)
  })

  it('telt de gerechten per pakket', () => {
    expect(gerechtenInPakket(pakketVan('lunch-basic')!)).toBe(7)
    for (const p of PAKKETTEN) expect(gerechtenInPakket(p)).toBeGreaterThan(0)
  })
})
