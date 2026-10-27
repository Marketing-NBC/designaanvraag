/**
 * De velden in Asana.
 *
 * Hier is iets misgegaan dat deze toetsen moeten voorkomen: de knop "Menuscherm" stond
 * wel in scripts/asana-field-map.json en de code las hem uit, maar niemand had het veld
 * in Asana aangemaakt - de velden-workflow leest alleen uit. Het gevolg was een knop die
 * niet bestond, en de enige melding daarover was een regel op stderr die de workflow niet
 * in zijn samenvatting zette. Een veld bijbedenken moet genoeg zijn; de rest hoort te
 * volgen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_DIR } from '../lib/config.mjs'
import { FIELD_SPECS, TAG_SPECS, tagBestaandeTaken, tagSleutel, veldsleutels, zorgVoorTags, zorgVoorVelden } from '../../scripts/asana-velden.mjs'
import { knopWaarde } from '../lib/asana-knop.mjs'

const map = JSON.parse(readFileSync(join(REPO_DIR, 'scripts', 'asana-field-map.json'), 'utf8'))

test('elk veld uit de map wordt ook ergens aangemaakt', () => {
  const specs = new Set(FIELD_SPECS.map((s) => s.key))
  for (const key of veldsleutels(map)) {
    assert.ok(specs.has(key),
      `"${key}" staat in asana-field-map.json maar in geen enkele FIELD_SPEC: `
      + 'dat veld komt nooit in Asana te staan.')
  }
  // En omgekeerd: een spec zonder naam in de map levert een veld zonder naam op.
  for (const spec of FIELD_SPECS) {
    assert.ok(map[spec.key], `FIELD_SPEC "${spec.key}" heeft geen veldnaam in asana-field-map.json`)
  }
})

test('elke optie heeft een label om in Asana te zetten', () => {
  for (const spec of FIELD_SPECS) {
    for (const [key] of spec.options ?? []) {
      const aliases = map.option_aliases?.[key]
      assert.ok(aliases?.length,
        `Optie "${key}" van veld "${spec.key}" heeft geen label in option_aliases; `
        + 'dan komt de sleutel zelf in Asana te staan.')
    }
  }
})

test('de knop heeft precies de standen die de code zet', () => {
  // De webhook zet "Genereer nu"/"Genereer nu (kleuren opdrachtgever)" om in een start en
  // zet "Bezig"; de worker zet daarna "Klaar" of "Mislukt". Alle vier moeten bestaan.
  const spec = FIELD_SPECS.find((s) => s.key === 'menuscherm')
  assert.ok(spec, 'het menuscherm-veld hoort bij de velden die we aanmaken')
  assert.deepEqual(spec.options.map(([k]) => k),
    ['genereer', 'genereer_kleur', 'bezig', 'klaar_menu', 'mislukt'])
  assert.equal(spec.type, 'enum', 'een knop met één stand per keer')
})

// ── zorgVoorVelden tegen een nagebootste Asana ────────────────────────

/** Een Asana die onthoudt wat er naartoe gaat. `velden` is wat er al in het project staat. */
function nepAsana(velden = []) {
  const calls = []
  let n = 0
  const api = async (path, { method = 'GET', body } = {}) => {
    calls.push({ method, path, body })
    if (method === 'GET' && path.includes('/custom_field_settings')) {
      return velden.map((f) => ({ custom_field: f }))
    }
    if (method === 'GET' && path.includes('/custom_fields')) return []
    if (method === 'POST' && path === '/custom_fields') {
      n += 1
      return { gid: `nieuw-${n}`, name: body.data.name,
               resource_subtype: body.data.resource_subtype,
               enum_options: (body.data.enum_options ?? []).map((o, i) => ({ ...o, gid: `o-${n}-${i}` })) }
    }
    return {}
  }
  return { api, calls }
}

test('een veld dat nog niet in Asana staat wordt aangemaakt, met de labels uit de map', async () => {
  const { api, calls } = nepAsana()
  const { warnings } = await zorgVoorVelden({
    asana: api, map, workspaceGid: 'ws', projectGid: 'proj', planningGid: null,
  })
  assert.deepEqual(warnings, [])

  const gemaakt = calls.filter((c) => c.method === 'POST' && c.path === '/custom_fields')
  assert.deepEqual(gemaakt.map((c) => c.body.data.name).sort(),
    veldsleutels(map).map((k) => map[k]).sort(), 'alle velden uit de map horen aangemaakt te worden')

  const knop = gemaakt.find((c) => c.body.data.name === 'Menuscherm')
  assert.equal(knop.body.data.resource_subtype, 'enum')
  assert.deepEqual(knop.body.data.enum_options.map((o) => o.name),
    ['Genereer nu', 'Genereer nu (kleuren opdrachtgever)', 'Bezig', 'Klaar', 'Mislukt'])

  // Een veld dat niet aan het project hangt kun je in Asana niet invullen.
  const gekoppeld = calls.filter((c) => c.path === '/projects/proj/addCustomFieldSetting')
  assert.equal(gekoppeld.length, gemaakt.length)
})

test('een bestaand veld houdt zijn gid en krijgt alleen de ontbrekende opties', async () => {
  const bestaand = veldsleutels(map).map((k) => ({
    gid: `bestaat-${k}`, name: map[k],
    resource_subtype: FIELD_SPECS.find((s) => s.key === k).type,
    enum_options: k === 'menuscherm' ? [{ gid: 'o1', name: 'Genereer nu', enabled: true }] : [],
  }))
  const { api, calls } = nepAsana(bestaand)
  await zorgVoorVelden({ asana: api, map, workspaceGid: 'ws', projectGid: 'proj' })

  assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/custom_fields').length, 0,
    'bestaande velden mogen nooit opnieuw aangemaakt worden - dan verlies je de ingevulde waarden')
  const opties = calls.filter((c) => c.path === '/custom_fields/bestaat-menuscherm/enum_options')
  assert.deepEqual(opties.map((c) => c.body.data.name),
    ['Genereer nu (kleuren opdrachtgever)', 'Bezig', 'Klaar', 'Mislukt'])
})

test('een veld dat Asana niet aankan blijft een waarschuwing, geen crash', async () => {
  const api = async (path, { method = 'GET' } = {}) => {
    if (method === 'GET' && path.includes('/custom_field_settings')) return []
    if (method === 'GET' && path.includes('/custom_fields')) return []
    const e = new Error('custom fields are only available on paid plans')
    e.status = 402
    throw e
  }
  const { warnings } = await zorgVoorVelden({ asana: api, map, workspaceGid: 'ws', projectGid: 'proj' })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /abonnement/)
})

// ── De knop terugzetten ───────────────────────────────────────────────

const CFG = {
  fields: {
    menuscherm: { gid: 'v1', name: 'Menuscherm', options: { klaar_menu: 'k', mislukt: 'm' } },
    huisstijl: { gid: 'v2', name: 'Huisstijl', options: { klaar_huisstijl: 'kh', mislukt: 'mh' } },
  },
}

test('de worker zet de knop op de gid uit de veldconfiguratie', () => {
  assert.deepEqual(knopWaarde(CFG, 'menuscherm', 'klaar_menu').waarde, { v1: 'k' })
  assert.deepEqual(knopWaarde(CFG, 'menuscherm', 'mislukt').waarde, { v1: 'm' })
})

test('de twee knoppen zitten elkaar niet in de weg', () => {
  // Menuscherm en Huisstijl delen optienamen als "mislukt", maar het zijn aparte
  // velden met aparte optie-gids. Door elkaar halen zou de verkeerde knop omzetten.
  assert.deepEqual(knopWaarde(CFG, 'huisstijl', 'mislukt').waarde, { v2: 'mh' })
  assert.deepEqual(knopWaarde(CFG, 'huisstijl', 'klaar_huisstijl').waarde, { v2: 'kh' })
  assert.match(knopWaarde(CFG, 'huisstijl', 'klaar_menu').reden, /geen optie "klaar_menu"/)
})

test('zonder veld of optie zegt de knop waarom het niet kan', () => {
  assert.match(knopWaarde(null, 'menuscherm', 'klaar_menu').reden, /Asana-velden vernieuwen/)
  assert.match(knopWaarde({ fields: {} }, 'menuscherm', 'klaar_menu').reden, /staat niet in/)
  const zonderOptie = { fields: { menuscherm: { gid: 'v1', options: {} } } }
  assert.match(knopWaarde(zonderOptie, 'menuscherm', 'klaar_menu').reden, /geen optie "klaar_menu"/)
  // De melding noemt het veld bij zijn naam in Asana, niet bij onze sleutel.
  assert.match(knopWaarde({ fields: {} }, 'huisstijl', 'bezig').reden, /"huisstijl"/)
})

// ── Kalendertags ──────────────────────────────────────────────────────

test('elke kalendertag heeft een naam, en geen ervan is rood', () => {
  for (const spec of TAG_SPECS) {
    assert.ok(map.tags?.[spec.key], `tag "${spec.key}" heeft geen naam in asana-field-map.json`)
    // Rood is van de reminders; een spoedje mag daar niet op lijken.
    assert.ok(!/red/.test(spec.color) && !/red/.test(spec.terugval), `tag "${spec.key}" is rood`)
  }
  assert.deepEqual(['evenement', 'evenement_spoed', 'intern', 'intern_spoed'].map((k) => TAG_SPECS.some((t) => t.key === k)), [true, true, true, true])
})

test('de tag vangt soort en spoed samen', () => {
  assert.equal(tagSleutel('evenement', false), 'evenement')
  assert.equal(tagSleutel('evenement', true), 'evenement_spoed')
  assert.equal(tagSleutel('intern', false), 'intern')
  assert.equal(tagSleutel('intern', true), 'intern_spoed')
})

test('ontbrekende tags worden aangemaakt; bestaande houden hun kleur', async () => {
  const calls = []
  const api = async (path, { method = 'GET', body } = {}) => {
    calls.push({ path, method, body })
    if (method === 'GET') return path.includes('query=Intern%20spoed') ? [{ gid: 'bestaat', name: 'Intern spoed', color: 'magenta' }] : []
    // De eerste keer weigert Asana de nieuwe kleurnaam, dan moet de oude het doen.
    if (body.data.color === 'aqua') { const e = new Error('invalid color'); e.status = 400; throw e }
    return { gid: `nieuw-${body.data.name}`, name: body.data.name }
  }
  const { tags, warnings } = await zorgVoorTags({ asana: api, map, workspaceGid: 'ws' })
  assert.deepEqual(warnings, [])
  assert.equal(tags.intern_spoed.gid, 'bestaat')
  assert.equal(tags.evenement.gid, 'nieuw-Evenement')
  const posts = calls.filter((c) => c.method === 'POST')
  assert.ok(!posts.some((c) => c.body.data.name === 'Intern spoed'), 'een bestaande tag niet opnieuw aanmaken')
  assert.deepEqual(posts.filter((c) => c.body.data.name === 'Evenement').map((c) => c.body.data.color), ['aqua', 'light-teal'])
})

test('alleen uitlezen maakt niets aan', async () => {
  const calls = []
  const api = async (path, { method = 'GET' } = {}) => (calls.push(method), [])
  const { tags, warnings } = await zorgVoorTags({ asana: api, map, workspaceGid: 'ws', aanmaken: false })
  assert.deepEqual(tags, {})
  assert.equal(warnings.length, 4)
  assert.ok(calls.every((m) => m === 'GET'))
})

test('bestaande taken krijgen de tag die bij hun velden hoort', async () => {
  const tags = { evenement: { gid: 'tEv', name: 'Evenement' }, evenement_spoed: { gid: 'tEvS', name: 'Evenement spoed' }, intern: { gid: 'tIn', name: 'Intern' }, intern_spoed: { gid: 'tInS', name: 'Intern spoed' } }
  const fields = { soort: { gid: 'fS', options: { evenement: 'oEv', intern: 'oIn' } }, spoed: { gid: 'fSp', options: { ja: 'oJa', nee: 'oNee' } } }
  const veld = (gid, waarde) => ({ gid, enum_value: waarde ? { gid: waarde } : null })
  const taken = [
    { gid: '1', name: 'Oud evenement', tags: [], custom_fields: [] },
    { gid: '2', name: 'Spoedje', tags: [], custom_fields: [veld('fSp', 'oJa')] },
    { gid: '3', name: 'Intern', tags: [{ gid: 'reminder' }], custom_fields: [veld('fS', 'oIn'), veld('fSp', 'oNee')] },
    { gid: '4', name: 'Al getagd', tags: [{ gid: 'tEv' }], custom_fields: [veld('fSp', 'oJa')] },
  ]
  const gezet = []
  const api = async (path, { body }) => { gezet.push([path, body.data.tag]); return {} }
  const { getagd } = await tagBestaandeTaken({ asana: api, lijst: async () => taken, projectGid: 'p', tags, fields })
  assert.deepEqual(gezet, [['/tasks/1/addTag', 'tEv'], ['/tasks/2/addTag', 'tEvS'], ['/tasks/3/addTag', 'tIn']])
  assert.equal(getagd.length, 3)
})
