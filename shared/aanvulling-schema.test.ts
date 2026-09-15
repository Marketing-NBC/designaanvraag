import { describe, expect, it } from 'vitest'
import { aanvullingPayloadSchema, aanvullingSchema } from './aanvulling-schema'

const basis = {
  aanvraag_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  naam: 'Wendy Tester',
  toelichting: 'Er komen ook vlaggen bij.',
}

describe('aanvullingSchema', () => {
  it('neemt genoegen met een aanvraag, een naam en een toelichting', () => {
    const r = aanvullingSchema.parse(basis)
    expect(r.extra_types).toEqual([])
    expect(r.nieuwe_event_datum).toBeNull()
    expect(r.nieuwe_deadline).toBeNull()
    expect(r.link).toBe('')
  })

  it('wijst een te korte toelichting af', () => {
    const r = aanvullingSchema.safeParse({ ...basis, toelichting: 'ja' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(['toelichting'])
  })

  it('vraagt door bij "Anders"', () => {
    expect(aanvullingSchema.safeParse({ ...basis, extra_types: ['anders'] }).success).toBe(false)
    expect(aanvullingSchema.safeParse({ ...basis, extra_types: ['anders'], anders_tekst: 'Spandoek' }).success).toBe(true)
  })

  it('maakt van een kale link een https-adres en weigert onzin', () => {
    expect(aanvullingSchema.parse({ ...basis, link: 'wetransfer.com/abc' }).link).toBe('https://wetransfer.com/abc')
    const stuk = aanvullingSchema.safeParse({ ...basis, link: 'geen link' })
    expect(stuk.success).toBe(false)
    expect(stuk.error?.issues[0]?.path).toEqual(['link'])
  })

  it('houdt de deadline binnen het event wanneer beide datums meekomen', () => {
    const fout = aanvullingSchema.safeParse({ ...basis, nieuwe_event_datum: '2026-12-01', nieuwe_deadline: '2026-12-05' })
    expect(fout.success).toBe(false)
    expect(fout.error?.issues[0]?.path).toEqual(['nieuwe_deadline'])
    expect(aanvullingSchema.safeParse({ ...basis, nieuwe_event_datum: '2026-12-01', nieuwe_deadline: '2026-11-20' }).success).toBe(true)
  })

  it('weigert een onbekend aanvraagtype', () => {
    expect(aanvullingSchema.safeParse({ ...basis, extra_types: ['taart'] }).success).toBe(false)
  })
})

describe('aanvullingPayloadSchema', () => {
  const payload = { aanvulling: basis, client_request_id: crypto.randomUUID(), started_at: new Date().toISOString() }

  it('accepteert een lege honeypot en weigert een gevulde', () => {
    expect(aanvullingPayloadSchema.safeParse({ ...payload, website_confirm: '' }).success).toBe(true)
    expect(aanvullingPayloadSchema.safeParse({ ...payload, website_confirm: 'bot' }).success).toBe(false)
  })

  it('eist een echte uuid en een tijdstempel', () => {
    expect(aanvullingPayloadSchema.safeParse({ ...payload, client_request_id: 'abc' }).success).toBe(false)
    expect(aanvullingPayloadSchema.safeParse({ ...payload, started_at: 'gisteren' }).success).toBe(false)
  })
})
