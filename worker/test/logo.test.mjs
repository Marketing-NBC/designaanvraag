/**
 * Het logo van de opdrachtgever.
 *
 * Marketing hangt het aan de subtaak van het menuscherm; de worker haalt het daar
 * op en zet het in de balk rechtsboven. Wat hier getoetst wordt is de keuze: welke
 * bijlage is het logo, en wat doen we met wat er verder hangt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WORKER_DIR } from '../lib/config.mjs'
import { bruikbaarAlsLogo, kiesLogo, logoDataUri } from '../menu/logo.mjs'
import { isMenuSubtaak, MENU_SUBTAAK_NAMEN, subtaskTitles } from '../../shared/asana-title.ts'

const NBC_LOGO = join(WORKER_DIR, '..', 'web', 'src', 'assets', 'brand', 'nbc-logo-color-black.png')

test('een drukwerkbestand is geen logo dat wij kunnen zetten', () => {
  for (const naam of ['logo.png', 'LOGO.PNG', 'merk.jpg', 'merk.jpeg', 'huisstijl.svg', 'logo.webp']) {
    assert.equal(bruikbaarAlsLogo({ name: naam }), true, naam)
  }
  // Een PDF, EPS of .ai kan de browser niet als afbeelding zetten. Die moeten we
  // weigeren met een duidelijke melding, niet stilletjes overslaan.
  for (const naam of ['logo.pdf', 'logo.eps', 'logo.ai', 'briefing.docx', 'logo']) {
    assert.equal(bruikbaarAlsLogo({ name: naam }), false, naam)
  }
})

test('van meerdere bijlagen wint die met "logo" in de naam', () => {
  const { logo } = kiesLogo([
    { gid: '1', name: 'plattegrond.png', created_at: '2026-09-01T10:00:00Z' },
    { gid: '2', name: 'Deloitte-logo.png', created_at: '2026-09-01T09:00:00Z' },
  ])
  assert.equal(logo.gid, '2', 'de bijlage met "logo" in de naam hoort te winnen')
})

test('zonder naamhint wint de nieuwste', () => {
  const { logo, meerdere } = kiesLogo([
    { gid: '1', name: 'oud.png', created_at: '2026-09-01T10:00:00Z' },
    { gid: '2', name: 'nieuw.png', created_at: '2026-09-02T10:00:00Z' },
  ])
  assert.equal(logo.gid, '2')
  assert.equal(meerdere, true, 'dat er gekozen is moet gemeld kunnen worden')
})

test('hangt er niets bruikbaars, dan zegt de uitkomst wat er wel hing', () => {
  const bijlagen = [{ gid: '1', name: 'huisstijl.pdf' }]
  const { logo, onbruikbaar } = kiesLogo(bijlagen)
  assert.equal(logo, null)
  assert.deepEqual(onbruikbaar, bijlagen)

  // En helemaal geen bijlagen is iets anders dan een onbruikbare: dan is het
  // wachten, niet mislukken.
  assert.deepEqual(kiesLogo([]), { logo: null, onbruikbaar: [] })
})

test('een logo wordt een data-URI die de engine kan zetten', async () => {
  const uri = await logoDataUri({ name: 'nbc.png', buffer: readFileSync(NBC_LOGO) })
  assert.match(uri, /^data:image\/png;base64,/)
  assert.ok(uri.length > 1000, 'dat is wel een erg klein logo')
})

test('een svg gaat ongemoeid mee', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')
  const uri = await logoDataUri({ name: 'merk.svg', buffer: svg })
  assert.match(uri, /^data:image\/svg\+xml;base64,/)
  assert.equal(Buffer.from(uri.split(',')[1], 'base64').toString(), svg.toString())
})

test('een menu-aanvraag krijgt altijd de subtaak waar het logo aan hangt', () => {
  const a = { aanvraag_types: ['menu_scherm'], anders_tekst: '', event: 'Deloitte',
              event_datum: '2026-10-20', naam: 'Wendy' }
  const namen = subtaskTitles(a)
  assert.deepEqual(namen, ['Menu scherm Deloitte'])
  assert.ok(namen.every(isMenuSubtaak), 'de worker moet zijn eigen subtaak terugvinden')
  assert.ok(MENU_SUBTAAK_NAMEN.length >= 2, 'menukaart en menuscherm horen er allebei in')
})
