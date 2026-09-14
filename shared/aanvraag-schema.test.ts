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
