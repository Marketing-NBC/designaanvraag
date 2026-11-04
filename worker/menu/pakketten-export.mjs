#!/usr/bin/env node
/**
 * Schrijft shared/menu-pakketten.json: de pakketten met hun gerechten, zoals ze in
 * het basisontwerp staan.
 *
 * Het formulier laat de collega een pakket kiezen en daarna zien wat erin zit, zodat
 * hij alleen nog de wijzigingen hoeft aan te geven. Daarvoor heeft de browser dezelfde
 * gerechten nodig als de opmaak-engine - en precies dezelfde spelling, want anders
 * typt iemand iets over wat de engine niet terugvindt.
 *
 * Daarom geen tweede lijst met de hand, maar deze afgeleid uit de bevroren
 * basisontwerpen. Draaien na elke extractie:  node worker/menu/pakketten-export.mjs
 *
 * Met --taal en schrijft hij shared/menu-pakketten-en.json uit de Engelse basisontwerpen
 * (basis/en/). Het Engelse Illustrator-bestand is daarmee de bron van de Engelse menu's.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_DIR } from '../lib/config.mjs'
import { parseArgs } from '../lib/config.mjs'
import { laadBasis, inhoudVanBasis, pakketten } from './render.mjs'

/**
 * Hoe het pakket heet in de gerechtenbibliotheek van NBC. Dat is de naam die
 * Marketing en de keuken gebruiken, dus die hoort de aanvrager te zien - niet onze
 * bestandsnaam.
 */
const NAMEN = {
  'lunch-standaard': 'Standard Lunch',
  'lunch-basic': 'Basic Lunch',
  'lunch-vega-standaard': 'Standard Lunch vega',
  'lunch-vega-basic': 'Basic Lunch vega',
  'grab-and-go': 'Grab & Go',
  'buffet': 'Winterbuffet',
  'diner-3gangen': 'Driegangenmenu sit-down diner',
  'diner-4gangen': 'Viergangenmenu sit-down diner',
  'walking-dinner': 'Walking dinner',
}

/** De namen in het Engels. */
const NAMEN_EN = {
  'lunch-standaard': 'Standard Lunch',
  'lunch-basic': 'Basic Lunch',
  'lunch-vega-standaard': 'Standard Lunch (vegetarian)',
  'lunch-vega-basic': 'Basic Lunch (vegetarian)',
  'grab-and-go': 'Grab & Go',
  'buffet': 'Winter buffet',
  'diner-3gangen': 'Three-course sit-down dinner',
  'diner-4gangen': 'Four-course sit-down dinner',
  'walking-dinner': 'Walking dinner',
}

/** De regel zoals hij op het scherm komt, om een gerecht mee te tonen en te zoeken. */
export function gerechtregel(g) {
  if (g.onderdelen) {
    return [g.naam, ...g.onderdelen.map((o) => `• ${o.naam}`)].join(' ')
  }
  return [g.naam, ...(g.ingredienten ?? [])].filter(Boolean).join(' | ')
}

function bouw(taal) {
  const namen = taal === 'en' ? NAMEN_EN : NAMEN
  const lijst = []
  const alle = new Map()
  for (const naam of pakketten(taal)) {
    const inhoud = inhoudVanBasis(laadBasis(naam, taal))
    if (!namen[naam]) throw new Error(`Pakket "${naam}" heeft geen naam in ${taal === 'en' ? 'NAMEN_EN' : 'NAMEN'}; vul die aan.`)
    lijst.push({ pakket: naam, naam: namen[naam], titel: inhoud.titel, secties: inhoud.secties })
    for (const sectie of inhoud.secties) {
      for (const g of sectie.gerechten) {
        const regel = gerechtregel(g)
        if (!alle.has(regel)) alle.set(regel, { ...g, uit: [] })
        alle.get(regel).uit.push(naam)
      }
    }
  }
  // Alle gerechten bij elkaar: daaruit kiest de aanvrager als hij er een wil wisselen.
  const gerechten = [...alle.values()].sort((a, b) => a.naam.localeCompare(b.naam, taal))
  return {
    _comment: taal === 'en'
      ? 'Gegenereerd door worker/menu/pakketten-export.mjs --taal en uit de Engelse basisontwerpen '
        + '(worker/menu/basis/en/, uit Flexibele-template-designs-V1_ENG.ai). Niet met de hand bewerken.'
      : 'Gegenereerd door worker/menu/pakketten-export.mjs uit de bevroren '
        + 'basisontwerpen. Niet met de hand bewerken.',
    pakketten: lijst,
    gerechten,
  }
}

const taal = parseArgs().taal === 'en' ? 'en' : 'nl'
const doel = join(REPO_DIR, 'shared', taal === 'en' ? 'menu-pakketten-en.json' : 'menu-pakketten.json')
const data = bouw(taal)
writeFileSync(doel, JSON.stringify(data, null, 2) + '\n')
console.log(`Geschreven: ${doel}`)
console.log(`${data.pakketten.length} pakketten, ${data.gerechten.length} verschillende gerechten`)
for (const p of data.pakketten) {
  const n = p.secties.reduce((t, s) => t + s.gerechten.length, 0)
  console.log(`  ${p.naam.padEnd(32)} ${p.secties.length} onderdelen, ${n} gerechten`)
}
