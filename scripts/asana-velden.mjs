/**
 * De custom fields zoals ze in Asana horen te staan, en de code die daarvoor zorgt.
 *
 * Dit stond eerst in scripts/asana-setup.mjs, dat je maar één keer draait. Daardoor
 * kreeg een veld dat later bijkwam - de knop "Menuscherm" - nooit zijn plek in Asana:
 * scripts/asana-fields.mjs leest alleen uit en zette het veld dus niet, maar meldde
 * dat alleen in een regel onderaan de workflow. Nu kan ook de velden-workflow
 * aanmaken wat er mist, zodat een nieuw veld in asana-field-map.json genoeg is.
 *
 * De namen van de velden en de labels van de opties staan in asana-field-map.json;
 * hier staat alleen wat voor soort veld het is en in welke kleur de opties komen.
 */

/** Velden zoals de edge function ze invult (zie supabase/functions/_shared/asana.ts → buildCustomFields). */
export const FIELD_SPECS = [
  {
    key: 'locatie',
    type: 'enum',
    description: 'Voor welke locatie de aanvraag is. Bepaalt in het formulier welke aanvraagtypes '
      + 'er te kiezen zijn: Green Village heeft bijvoorbeeld geen LED-kolom.',
    options: [
      ['nbc', 'blue-green'],
      ['green_village', 'green'],
    ],
  },
  {
    key: 'soort',
    type: 'enum',
    description: 'Voor een evenement of intern. Een interne aanvraag heeft geen event, eventdatum of '
      + 'website: alleen wat er nodig is (in de beschrijving) en de deadline.',
    // Twee kleuren die niet op elkaar en niet op de andere velden lijken, zodat je op het bord in
    // een oogopslag ziet wat intern is.
    options: [
      ['evenement', 'blue'],
      ['intern', 'hot-pink'],
    ],
  },
  { key: 'eventdatum', type: 'date', description: 'Datum van het event. Leeg bij een interne aanvraag.' },
  { key: 'deadline', type: 'date', description: 'Wanneer de aanvrager het design uiterlijk nodig heeft. De vervaldatum van de taak kiest Marketing zelf bij het inplannen.' },
  {
    key: 'aanvrager',
    type: 'enum',
    description: 'Wie de aanvraag heeft ingediend. Een keuzelijst, zodat het dashboard erop kan groeperen; '
      + 'een nieuwe naam komt er vanzelf bij.',
    // Geen vaste opties: de edge function maakt de optie aan zodra iemand voor het eerst een
    // aanvraag doet. Zo staan er geen namen van collega's in deze (publieke) repo.
    optiesViaFunction: true,
    // Dit veld was eerder een tekstveld; Asana kan het type niet wijzigen, dus vervangen.
    vervangBijAnderType: true,
  },
  {
    key: 'type',
    type: 'multi_enum',
    description: 'Wat er is aangevraagd.',
    options: [
      ['led_kolom', 'blue'],
      ['torenscherm', 'aqua'],
      ['koffiescherm', 'blue-green'],
      ['overige_schermen', 'indigo'],
      ['menukaart_print', 'yellow-orange'],
      ['menu_scherm', 'orange'],
      ['vlaggen', 'green'],
      ['anders', 'cool-gray'],
    ],
  },
  {
    key: 'modus',
    type: 'enum',
    description: 'Volledig custom ontwerp of de standaard templates van de locatie.',
    options: [
      ['custom', 'purple'],
      ['standaard', 'green'],
    ],
  },
  { key: 'website', type: 'text', description: 'Website van de opdrachtgever of het event (bron voor de huisstijl).' },
  { key: 'schijf', type: 'text', description: 'Locatie op de G-schijf met meer informatie of bestaande designs.' },
  {
    key: 'menukleuren',
    type: 'text',
    description:
      'Welke kleuren het menuscherm krijgt, als je ze zelf wil bepalen. Eén hexcode voor de blobs '
      + '(#5b2d8e), twee voor de blobs en de kopjes (#5b2d8e, #ff6600), drie als ook de tekst mee '
      + 'moet (#5b2d8e, #ff6600, #1d1d1b). Die derde kleurt de titel, de gerechten en het '
      + 'dieetwens-blok. Wat hier staat wint van de huisstijl die automatisch is opgehaald. Werkt '
      + 'samen met "Genereer nu (kleuren opdrachtgever)"; laat het leeg om de opgehaalde huisstijl '
      + 'te gebruiken.',
  },
  {
    key: 'spoed',
    type: 'enum',
    description: 'Minder dan 10 werkdagen tussen de aanvraag en het event (bij een interne aanvraag: de deadline). '
      + 'Wordt automatisch gezet bij het indienen.',
    // De optiekleuren bepalen ook de kleur bij "kleuren op veld" in de kalender van de werkplanning:
    // spoedjes rood, de rest neutraal grijs zodat alleen spoed opvalt.
    options: [
      ['ja', 'red'],
      ['nee', 'cool-gray'],
    ],
    /** Dit veld hoort ook in het planningsproject, anders kun je daar niet op kleuren. */
    ookInPlanning: true,
  },
  {
    key: 'menuscherm',
    type: 'enum',
    description:
      'De knop waarmee je een menuscherm laat maken. Hang eerst het logo van de opdrachtgever aan de '
      + 'subtaak "Menu scherm", zet dit veld dan op "Genereer nu" - of op "Genereer nu (kleuren '
      + 'opdrachtgever)" als de blobs en de kopjes in de huisstijl van de opdrachtgever moeten. '
      + 'De rest zet zichzelf: Bezig zodra het begonnen is, Klaar of Mislukt als het af is.',
    options: [
      ['genereer', 'orange'],
      ['genereer_kleur', 'yellow-orange'],
      ['bezig', 'yellow'],
      ['klaar_menu', 'green'],
      ['mislukt', 'red'],
    ],
  },
  {
    key: 'huisstijl',
    type: 'enum',
    description:
      'De knop waarmee je de huisstijl van de opdrachtgever opnieuw laat ophalen. Zet hem op '
      + '"Haal opnieuw op" als het de eerste keer is misgelukt, of als de website inmiddels is '
      + 'veranderd. De rest zet zichzelf: Bezig zodra het begonnen is, Klaar of Mislukt als het '
      + 'af is. Wat er gevonden is komt als comment en bijlagen bij deze taak te staan.',
    options: [
      ['opnieuw', 'purple'],
      ['bezig', 'yellow'],
      ['klaar_huisstijl', 'green'],
      ['mislukt', 'red'],
    ],
  },
]

/** De veldsleutels uit asana-field-map.json; de rest van dat bestand is geen veld. */
export function veldsleutels(map) {
  return Object.keys(map).filter((k) => !k.startsWith('_') && !['option_aliases', 'sections', 'tags'].includes(k))
}

const norm = (s) => String(s ?? '').trim().toLowerCase()

/**
 * Zorgt dat elk veld uit FIELD_SPECS in het project staat, met de opties uit
 * asana-field-map.json. Veilig om opnieuw te draaien: bestaande velden en opties
 * worden hergebruikt, ontbrekende opties aangevuld.
 *
 * @param {object} o
 * @param {(path: string, opts?: {method?: string, body?: object}) => Promise<any>} o.asana  client die gooit bij een fout
 * @param {object} o.map            de inhoud van scripts/asana-field-map.json
 * @param {string} o.workspaceGid   workspace waarin een nieuw veld wordt aangemaakt
 * @param {string} o.projectGid     project waar het veld aan gekoppeld moet zijn
 * @param {string|null} o.planningGid  planningsproject, voor velden met ookInPlanning
 * @returns {Promise<{summary: string[], warnings: string[]}>}
 */
export async function zorgVoorVelden({ asana, map, workspaceGid, projectGid, planningGid = null }) {
  const summary = []
  const warnings = []

  const settings = await asana(
    `/projects/${projectGid}/custom_field_settings?limit=100&opt_fields=custom_field.gid,custom_field.name,custom_field.resource_subtype,custom_field.enum_options.gid,custom_field.enum_options.name,custom_field.enum_options.enabled`,
  )
  const onProject = settings.map((s) => s.custom_field)
  let library = null
  try {
    library = await asana(`/workspaces/${workspaceGid}/custom_fields?limit=100&opt_fields=name,resource_subtype,enum_options.gid,enum_options.name,enum_options.enabled`)
  } catch (e) {
    warnings.push(`Kon de veldenbibliotheek niet lezen (${e.message}); velden worden zo nodig nieuw aangemaakt.`)
  }

  // Sommige velden horen ook in het planningsproject ("4. Werkplanning"): alleen velden die daar aan
  // het project hangen kun je in de kalender als kleur gebruiken.
  let planningVelden = null
  async function koppelAanPlanning(field) {
    if (!planningGid) return
    try {
      if (!planningVelden) {
        const s = await asana(`/projects/${planningGid}/custom_field_settings?limit=100&opt_fields=custom_field.gid`)
        planningVelden = new Set(s.map((x) => x.custom_field?.gid).filter(Boolean))
      }
      if (planningVelden.has(field.gid)) return
      await asana(`/projects/${planningGid}/addCustomFieldSetting`, { method: 'POST', body: { data: { custom_field: field.gid, is_important: false } } })
      planningVelden.add(field.gid)
      summary.push(`Veld "${field.name}" ook aan het planningsproject gekoppeld (voor de kleur in de kalender)`)
    } catch (e) {
      warnings.push(`Veld "${field.name}" kon niet aan het planningsproject gekoppeld worden: ${e.message}`)
    }
  }

  let premiumBlocked = false
  for (const spec of FIELD_SPECS) {
    if (premiumBlocked) break
    const name = map[spec.key]
    if (!name) {
      warnings.push(`Geen veldnaam voor "${spec.key}" in asana-field-map.json.`)
      continue
    }
    const optionLabel = (ourKey) => map.option_aliases?.[ourKey]?.[0] ?? ourKey
    try {
      let field = onProject.find((f) => norm(f.name) === norm(name)) ?? library?.find((f) => norm(f.name) === norm(name)) ?? null
      let status = 'bestond al'
      if (field && field.resource_subtype !== spec.type) {
        if (spec.vervangBijAnderType) {
          // Asana kan het type van een bestaand veld niet wijzigen, dus het oude veld gaat weg en er
          // komt een nieuw veld met dezelfde naam voor in de plaats.
          await asana(`/custom_fields/${field.gid}`, { method: 'DELETE' })
          const weg = onProject.findIndex((f) => f.gid === field.gid)
          if (weg >= 0) onProject.splice(weg, 1)
          summary.push(`Veld "${name}" bestond als ${field.resource_subtype} en is verwijderd om het als ${spec.type} opnieuw aan te maken`)
          field = null
          status = 'vervangen'
        } else {
          warnings.push(`Veld "${name}" bestaat al als ${field.resource_subtype}, verwacht ${spec.type}; de function past zich aan, maar check het veld.`)
        }
      }
      if (!field) {
        const data = { workspace: workspaceGid, name, resource_subtype: spec.type, description: spec.description }
        if (spec.options) data.enum_options = spec.options.map(([key, color]) => ({ name: optionLabel(key), color, enabled: true }))
        // Een enum-veld moet bij het aanmaken minstens één optie hebben; die van de aanvragers vult
        // de function later aan met de echte namen.
        if (spec.optiesViaFunction) data.enum_options = [{ name: 'Onbekend', color: 'none', enabled: true }]
        field = await asana('/custom_fields', { method: 'POST', body: { data } })
        if (status !== 'vervangen') status = 'aangemaakt'
      } else if (spec.options) {
        // Ontbrekende opties aanvullen op een bestaand enum-veld.
        const enabled = (field.enum_options ?? []).filter((o) => o.enabled !== false)
        for (const [key, color] of spec.options) {
          const aliases = map.option_aliases?.[key] ?? [key]
          if (enabled.some((o) => aliases.some((a) => norm(a) === norm(o.name)))) continue
          await asana(`/custom_fields/${field.gid}/enum_options`, { method: 'POST', body: { data: { name: optionLabel(key), color, enabled: true } } })
          status = 'opties aangevuld'
        }
      }
      if (!onProject.some((f) => f.gid === field.gid)) {
        await asana(`/projects/${projectGid}/addCustomFieldSetting`, { method: 'POST', body: { data: { custom_field: field.gid, is_important: true } } })
        onProject.push(field)
        if (status === 'bestond al') status = 'aan project gekoppeld'
      }
      if (spec.ookInPlanning) await koppelAanPlanning({ gid: field.gid, name })
      summary.push(`Veld "${name}" (${spec.type}): ${status}`)
    } catch (e) {
      if (e.status === 402 || /premium|paid|upgrade|starter/i.test(e.message)) {
        premiumBlocked = true
        warnings.push(
          `Custom fields zijn niet beschikbaar in dit Asana-abonnement (${e.message}). Het project werkt zonder velden: alle gegevens staan in de beschrijving en de deadline als due date.`,
        )
      } else {
        warnings.push(`Veld "${name}": ${e.message}`)
      }
    }
  }

  return { summary, warnings }
}

// ── Tags voor de kalender van de werkplanning ─────────────────────────

/**
 * De kalender van "4. Werkplanning" kleurt op tags: Reminder is rood, NBC blauw, GV groen. Een
 * veld kan daar niet naast, want Asana kleurt op één ding tegelijk, en dan zouden de reminders hun
 * rood kwijtraken. Daarom krijgt elke designaanvraag één tag die soort en spoed samen vangt, in een
 * kleur die nog niet in gebruik is - en zeker geen rood.
 *
 * `terugval` is dezelfde kleur in het oude palet van de API, voor als Asana de nieuwe naam weigert.
 * De namen staan in asana-field-map.json onder "tags".
 */
export const TAG_SPECS = [
  { key: 'evenement', color: 'aqua', terugval: 'light-teal' },
  { key: 'evenement_spoed', color: 'orange', terugval: 'dark-orange' },
  { key: 'intern', color: 'pink', terugval: 'light-pink' },
  { key: 'intern_spoed', color: 'purple', terugval: 'dark-purple' },
]

/** Welke tag een aanvraag krijgt. Dezelfde regel als tagSleutel in de edge function. */
export function tagSleutel(soort, spoed) {
  return `${soort === 'intern' ? 'intern' : 'evenement'}${spoed ? '_spoed' : ''}`
}

/**
 * Zoekt de tags op naam op en maakt met `aanmaken` aan wat er mist. Een tag die al bestaat houdt
 * zijn kleur: heeft Marketing die zelf aangepast, dan blijft dat zo.
 *
 * @returns {Promise<{tags: Record<string, {gid: string, name: string}>, summary: string[], warnings: string[]}>}
 */
export async function zorgVoorTags({ asana, map, workspaceGid, aanmaken = true }) {
  const tags = {}
  const summary = []
  const warnings = []
  for (const spec of TAG_SPECS) {
    const naam = map.tags?.[spec.key]
    if (!naam) {
      warnings.push(`Geen tagnaam voor "${spec.key}" in asana-field-map.json.`)
      continue
    }
    try {
      const gevonden = await asana(`/workspaces/${workspaceGid}/typeahead?resource_type=tag&count=20&opt_fields=name,color&query=${encodeURIComponent(naam)}`)
      let tag = (gevonden ?? []).find((t) => norm(t.name) === norm(naam)) ?? null
      if (tag) {
        summary.push(`Tag "${naam}": bestond al`)
      } else if (aanmaken) {
        tag = await maakTag(asana, workspaceGid, naam, spec)
        summary.push(`Tag "${naam}": aangemaakt`)
      } else {
        warnings.push(`Tag "${naam}" bestaat niet; draai met "Ontbrekende velden aanmaken" aan.`)
        continue
      }
      tags[spec.key] = { gid: tag.gid, name: tag.name ?? naam }
    } catch (e) {
      warnings.push(`Tag "${naam}": ${e.message}`)
    }
  }
  return { tags, summary, warnings }
}

async function maakTag(asana, workspaceGid, naam, spec) {
  try {
    return await asana('/tags', { method: 'POST', body: { data: { workspace: workspaceGid, name: naam, color: spec.color } } })
  } catch (e) {
    if (e.status !== 400) throw e
    return asana('/tags', { method: 'POST', body: { data: { workspace: workspaceGid, name: naam, color: spec.terugval } } })
  }
}

/**
 * Geeft de openstaande aanvragen die nog geen van deze tags hebben er alsnog een, op basis van de
 * velden Soort en Spoed op de taak zelf. Soort leeg betekent een evenement: tot het veld bestond
 * kon je niets anders aanvragen. Een taak die al een van de tags heeft blijft ongemoeid, dus
 * opnieuw draaien kan geen kwaad.
 *
 * `lijst` haalt alle pagina's van een lijst op.
 */
export async function tagBestaandeTaken({ asana, lijst, projectGid, tags, fields }) {
  const onze = new Set(Object.values(tags).map((t) => t.gid))
  const internGid = fields?.soort?.options?.intern ?? null
  const spoedJaGid = fields?.spoed?.options?.ja ?? null
  const taken = await lijst(`/projects/${projectGid}/tasks?completed_since=now&limit=100&opt_fields=name,tags.gid,custom_fields.gid,custom_fields.enum_value.gid`)

  const getagd = []
  const warnings = []
  for (const taak of taken) {
    if ((taak.tags ?? []).some((t) => onze.has(t.gid))) continue
    const waarde = (veldGid) => (taak.custom_fields ?? []).find((f) => f.gid === veldGid)?.enum_value?.gid ?? null
    const soort = internGid && waarde(fields.soort.gid) === internGid ? 'intern' : 'evenement'
    const spoed = Boolean(spoedJaGid && waarde(fields.spoed.gid) === spoedJaGid)
    const tag = tags[tagSleutel(soort, spoed)]
    if (!tag) continue
    try {
      await asana(`/tasks/${taak.gid}/addTag`, { method: 'POST', body: { data: { tag: tag.gid } } })
      getagd.push(`${taak.name} → ${tag.name}`)
    } catch (e) {
      warnings.push(`Taak "${taak.name}" niet getagd: ${e.message}`)
    }
  }
  return { getagd, warnings }
}
