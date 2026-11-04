/**
 * Het menuscherm in het Engels. Een eigen Illustrator-bestand (Flexibele-template-designs-V1_ENG.ai),
 * bevroren in worker/menu/basis/en/, met een eigen gerechtenbibliotheek. Verder werkt het precies
 * als het Nederlands: een onaangeroerd pakket komt er 1:1 uit zoals de ontwerper het zette.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engelseMenus, inhoudVanBasis, laadBasis, laadBibliotheek, pakketten, renderMenu } from '../menu/render.mjs'

test('alle Nederlandse pakketten bestaan ook in het Engels', () => {
  assert.deepEqual(pakketten('en'), pakketten('nl'))
})

test('elk Engels pakket heeft evenveel onderdelen als het Nederlandse', () => {
  for (const p of pakketten('en')) {
    assert.equal(inhoudVanBasis(laadBasis(p, 'en')).secties.length, inhoudVanBasis(laadBasis(p)).secties.length, p)
  }
})

test('de Engelse ontwerpen zijn Engels', () => {
  const tekst = JSON.stringify(pakketten('en').map((p) => inhoudVanBasis(laadBasis(p, 'en'))))
  for (const nl of ['Nagerecht', 'Voorgerecht', 'Hoofdgerecht', 'Chocoladetrifle', 'Broodjes', 'Op tafel']) {
    assert.ok(!tekst.includes(nl), `"${nl}" staat nog in een Engels ontwerp`)
  }
  assert.equal(laadBasis('diner-3gangen', 'en').voetregel.regels[0].tekst, 'Dietary requirements')
  assert.equal(laadBasis('lunch-vega-basic', 'en').ondertitel?.tekst, 'vegetarian')
})

test('de Engelse lijst in het formulier komt uit de Engelse ontwerpen', () => {
  const data = engelseMenus()
  assert.equal(data.pakketten.length, pakketten('en').length)
  for (const p of data.pakketten) {
    assert.deepEqual(p.secties, inhoudVanBasis(laadBasis(p.pakket, 'en')).secties, p.pakket)
  }
})

test('elke taal heeft zijn eigen gerechtenbibliotheek', () => {
  const en = JSON.stringify(laadBibliotheek('en'))
  assert.ok(en.includes('Sourdough bread'))
  assert.ok(!en.includes('Zuurdesembrood'))
})

test('een onaangeroerd Engels pakket komt er zonder meldingen uit', async () => {
  for (const pakket of ['grab-and-go', 'lunch-standaard']) {
    const { meldingen } = await renderMenu({ ...inhoudVanBasis(laadBasis(pakket, 'en')), taal: 'en' })
    assert.deepEqual(meldingen.botsingen, [], pakket)
    assert.deepEqual(meldingen.overloop, [], pakket)
    assert.deepEqual(meldingen.structuur, [], pakket)
  }
})
