import { describe, expect, it } from 'vitest'
import { aanvraagSchema, normalizeUrl, submitPayloadSchema } from './aanvraag-schema.ts'
import { describeRequestTypes } from './request-types.ts'

const valid = {
  naam: 'Naomi',
  event: 'Zorgcongres 2026',
  event_datum: '2026-11-20',
  deadline: '2026-11-10',
  website: 'www.zorgcongres.nl/programma',
  schijf_locatie: 'G:\\Events\\2026\\Zorgcongres',
  aanvraag_types: ['led_kolom', 'vlaggen'] as const,
  anders_tekst: '',
  design_modus: 'custom' as const,
  omschrijving: '',
}

describe('normalizeUrl', () => {
  it('voegt https toe en accepteert paden', () => {
    expect(normalizeUrl('nbc.nl')).toBe('https://nbc.nl/')
    expect(normalizeUrl('www.event.nl/x?y=1')).toBe('https://www.event.nl/x?y=1')
    expect(normalizeUrl('http://event.nl')).toBe('http://event.nl/')
  })
  it('wijst onzin af', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('geen url')).toBeNull()
    expect(normalizeUrl('localhost')).toBeNull()
    expect(normalizeUrl('ftp://event.nl')).toBeNull()
    expect(normalizeUrl('event')).toBeNull()
  })
})

describe('aanvraagSchema', () => {
  it('accepteert een geldige aanvraag en normaliseert de website', () => {
    const r = aanvraagSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.website).toBe('https://www.zorgcongres.nl/programma')
  })
  it('weigert een deadline na het event', () => {
    const r = aanvraagSchema.safeParse({ ...valid, deadline: '2026-12-01' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['deadline'])
  })
  it('vereist tekst bij Anders', () => {
    const r = aanvraagSchema.safeParse({ ...valid, aanvraag_types: ['anders'] })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['anders_tekst'])
  })
  it('vereist minimaal één type', () => {
    expect(aanvraagSchema.safeParse({ ...valid, aanvraag_types: [] }).success).toBe(false)
  })
  it('weigert een onbekend type', () => {
    expect(aanvraagSchema.safeParse({ ...valid, aanvraag_types: ['poster'] }).success).toBe(false)
  })
})

describe('submitPayloadSchema', () => {
  it('accepteert een payload met lege honeypot', () => {
    const r = submitPayloadSchema.safeParse({
      aanvraag: valid,
      client_request_id: '4f1a2b3c-4d5e-4f60-8a71-829394a5b6c7',
      started_at: new Date().toISOString(),
      website_confirm: '',
    })
    expect(r.success).toBe(true)
  })
  it('weigert een gevulde honeypot', () => {
    const r = submitPayloadSchema.safeParse({
      aanvraag: valid,
      client_request_id: '4f1a2b3c-4d5e-4f60-8a71-829394a5b6c7',
      started_at: new Date().toISOString(),
      website_confirm: 'spam',
    })
    expect(r.success).toBe(false)
  })
})

describe('describeRequestTypes', () => {
  it('vervangt Anders door de vrije tekst', () => {
    expect(describeRequestTypes(['led_kolom', 'anders'], 'Roll-up')).toBe('LED-kolom, Roll-up')
    expect(describeRequestTypes(['anders'], '')).toBe('Anders')
  })
})

describe('website is optioneel', () => {
  it('accepteert een lege website', () => {
    const r = aanvraagSchema.safeParse({ ...valid, website: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.website).toBe('')
  })

  it('accepteert een ontbrekende website', () => {
    const { website: _weg, ...zonder } = valid
    const r = aanvraagSchema.safeParse(zonder)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.website).toBe('')
  })

  it('wijst onzin nog steeds af', () => {
    expect(aanvraagSchema.safeParse({ ...valid, website: 'geen website' }).success).toBe(false)
  })
})

describe('culinaire invulling', () => {
  // Het menu wordt alleen gevraagd bij een menukaart of menuscherm; het formulier
  // laat die stap dan zien. Het schema bewaakt dat er niets binnenkomt wat daar
  // niet bij hoort, want dan zou er een menu staan bij een aanvraag die er niets
  // mee doet.
  const menu = 'Op tafel\n\n• Bruschetta-spiezen met seasonal dips'

  it('accepteert een menu bij een menuscherm', () => {
    const r = aanvraagSchema.safeParse({ ...valid, aanvraag_types: ['menu_scherm'], menu_tekst: menu })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.menu_tekst).toContain('Bruschetta')
  })

  it('accepteert een menu bij een menukaart print', () => {
    const r = aanvraagSchema.safeParse({ ...valid, aanvraag_types: ['menukaart_print'], menu_tekst: menu })
    expect(r.success).toBe(true)
  })

  it('weigert een menu als er geen menu is aangevraagd', () => {
    const r = aanvraagSchema.safeParse({ ...valid, menu_tekst: menu })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toEqual(['menu_tekst'])
  })

  it('laat het veld leeg als er geen menu bij hoort', () => {
    const r = aanvraagSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.menu_tekst).toBe('')
  })
})

describe('voor welke locatie de aanvraag is', () => {
  it('neemt NBC aan als het veld ontbreekt', () => {
    // Een concept dat iemand nog in zijn browser had staan van voor deze vraag bestond:
    // dat hoort gewoon verstuurd te kunnen worden, en alles van toen was NBC.
    const r = aanvraagSchema.safeParse(valid)
    expect(r.success && r.data.locatie).toBe('nbc')
  })

  it('laat een Green Village-aanvraag door met wat daar bestaat', () => {
    const r = aanvraagSchema.safeParse({
      ...valid, locatie: 'green_village', aanvraag_types: ['torenscherm', 'vlaggen'],
    })
    expect(r.success).toBe(true)
  })

  it('weigert een type dat die locatie niet heeft', () => {
    // Green Village heeft geen LED-kolom. Het formulier toont die daar ook niet, maar wie
    // eerst NBC koos en daarna omschakelde zou hem anders stilletjes mee kunnen sturen.
    const r = aanvraagSchema.safeParse({
      ...valid, locatie: 'green_village', aanvraag_types: ['led_kolom'],
    })
    expect(r.success).toBe(false)
    expect(r.success === false && r.error.issues[0]?.message)
      .toMatch(/LED-kolom kan niet bij Green Village/)
  })

  it('kent geen derde locatie', () => {
    expect(aanvraagSchema.safeParse({ ...valid, locatie: 'kasteel' }).success).toBe(false)
  })
})

describe('evenement of intern', () => {
  const intern = { soort: 'intern' as const, naam: 'Naomi', deadline: '2026-11-10', omschrijving: 'Nieuwe visitekaartjes voor sales.' }

  it('een aanvraag zonder soort is voor een evenement', () => {
    const r = aanvraagSchema.safeParse(valid)
    expect(r.success && r.data.soort).toBe('evenement')
  })

  it('een evenement zonder event, datum, types of design wordt geweigerd', () => {
    const r = aanvraagSchema.safeParse({ naam: 'Naomi', deadline: '2026-11-10' })
    expect(r.success).toBe(false)
    const velden = r.success ? [] : r.error.issues.map((i) => i.path[0])
    expect(velden).toEqual(expect.arrayContaining(['event', 'event_datum', 'aanvraag_types', 'design_modus']))
  })

  it('intern: alleen naam, deadline en wat er nodig is', () => {
    const r = aanvraagSchema.safeParse(intern)
    expect(r.success).toBe(true)
    if (r.success) expect([r.data.event, r.data.event_datum, r.data.design_modus]).toEqual(['', null, null])
  })

  it('intern: zonder deadline mag ook, "het mag klaar zijn wanneer het past"', () => {
    const r = aanvraagSchema.safeParse({ ...intern, deadline: null })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.deadline).toBeNull()
  })

  it('een evenement zonder deadline wordt geweigerd', () => {
    const r = aanvraagSchema.safeParse({ ...valid, deadline: null })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toContain('deadline')
  })

  it('intern: zonder omschrijving gaat het niet', () => {
    const r = aanvraagSchema.safeParse({ ...intern, omschrijving: '' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toEqual(['omschrijving'])
  })

  it('intern: wat er nog van een evenement in stond gaat eraf', () => {
    const r = aanvraagSchema.safeParse({ ...valid, ...intern })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.aanvraag_types).toEqual([])
      expect(r.data.website).toBe('')
      expect(r.data.schijf_locatie).toBe('')
    }
  })

  it('een naam die niet in de lijst staat mag gewoon', () => {
    expect(aanvraagSchema.safeParse({ ...valid, naam: 'Iemand van buiten de lijst' }).success).toBe(true)
    expect(aanvraagSchema.safeParse({ ...valid, naam: ' ' }).success).toBe(false)
  })
})
