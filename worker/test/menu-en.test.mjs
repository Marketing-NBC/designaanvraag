/**
 * Het menuscherm in het Engels. Het ontwerp is het Nederlandse basisontwerp; alleen de woorden
 * verschillen: de titel en de dieetwens-regel komen uit shared/menu-pakketten-en.json, de gerechten
 * staan er letterlijk zoals in het doc, en de Nederlandse gerechtenbibliotheek doet niet mee.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engelseMenus, inTaal, pakketten, pakkettenInTaal, renderMenu } from '../menu/render.mjs'

test('de Engelse pakketten bestaan allemaal als basisontwerp', () => {
  const basis = new Set(pakketten())
  for (const p of engelseMenus().pakketten) assert.ok(basis.has(p.pakket), p.pakket)
  assert.deepEqual(pakkettenInTaal('en').sort(), ['grab-and-go', 'lunch-basic', 'lunch-standaard', 'lunch-vega-basic', 'lunch-vega-standaard'])
  assert.equal(pakkettenInTaal('nl').length, pakketten().length)
})

test('Nederlands laat alles zoals het was', () => {
  const uit = inTaal({ pakket: 'buffet', titel: 'Buffet', secties: [] })
  assert.deepEqual(uit, { titel: 'Buffet', secties: [], voetregel: null, letterlijk: false })
})

test('Engels: titel, dieetwens-regel, en elk gerecht zoals het is aangeleverd', () => {
  const uit = inTaal({ pakket: 'grab-and-go', taal: 'en' })
  assert.equal(uit.titel, 'Grab & Go')
  assert.equal(uit.voetregel[0], 'Dietary requirements or allergies?')
  assert.equal(uit.letterlijk, true)
  assert.equal(uit.secties[0].kop, 'Appetisers')
  assert.ok(uit.secties.every((s) => s.gerechten.every((g) => g.bewerkt === true)))
})

test('een pakket dat er nog niet in het Engels is, geeft een duidelijke fout', () => {
  assert.throws(() => inTaal({ pakket: 'diner-4gangen', taal: 'en' }), /nog niet in het Engels/)
})

test('Grab & Go in het Engels past op het scherm, met de tekst uit het doc', async () => {
  const { meldingen, opmaak } = await renderMenu({ pakket: 'grab-and-go', taal: 'en' })
  assert.deepEqual(meldingen.botsingen, [])
  assert.deepEqual(meldingen.overloop, [])
  const tekst = JSON.stringify(opmaak)
  assert.ok(tekst.includes('Schiacciata Toscana'), 'de hoofdletter uit het doc blijft staan')
})
