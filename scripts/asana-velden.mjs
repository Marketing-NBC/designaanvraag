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
  {
    key: 'kleur',
    type: 'enum',
    description: 'Waarop de kalender van de werkplanning kleurt (Opties → Kleur → Kleur). Designaanvragen '
      + 'krijgen hun optie vanzelf: soort en spoed samen. Voor je eigen taken kies je zelf Reminder, NBC '
      + 'of GV. Asana kleurt maar op één ding tegelijk; daarom staat het allemaal in dit ene veld.',
    // Rood is van de reminders; een spoedje mag daar niet op lijken.
    options: [
      ['evenement', 'aqua'],
      ['evenement_spoed', 'orange'],
      ['intern', 'pink'],
      ['intern_spoed', 'purple'],
      ['reminder', 'red'],
      ['nbc', 'blue'],
      ['gv', 'green'],
    ],
    /** De kalender staat in het planningsproject, dus daar moet het veld ook hangen. */
    ookInPlanning: true,
    /** En in het deadlineproject, zodat de mijlpalen daar dezelfde kleur krijgen. */
    ookInDeadlines: true,
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
  {
    key: 'oplevermail',
    type: 'enum',
    description:
      'De knop waarmee je de aanvrager laat weten dat het ontwerp klaar is. Plaats eerst een reactie die '
      + 'begint met "Oplevering:", met de bestanden erbij, en zet dit veld dan op "Verstuur nu". De '
      + 'aanvrager en de adressen in "Ook mailen naar" krijgen die tekst en bestanden per mail, met een '
      + 'knop om feedback te geven. De rest zet zichzelf: Bezig, dan Verstuurd (en de taak naar Klaar) '
      + 'of Mislukt, met de reden in een reactie.',
    options: [
      ['verstuur', 'blue'],
      ['bezig', 'yellow'],
      ['verstuurd', 'green'],
      ['mislukt', 'red'],
    ],
  },
  {
    key: 'ook_mailen_naar',
    type: 'text',
    description:
      'Wie de opleveringsmail nog meer krijgt, naast de aanvrager. E-mailadressen gescheiden door een '
      + 'komma, ook van buiten NBC. Blijft staan voor de volgende versie.',
  },
]

/** De veldsleutels uit asana-field-map.json; de rest van dat bestand is geen veld. */
export function veldsleutels(map) {
  return Object.keys(map).filter((k) => !k.startsWith('_') && k !== 'option_aliases' && k !== 'sections')
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
 * @param {string|null} o.deadlinesGid deadlineproject, voor velden met ookInDeadlines
 * @returns {Promise<{summary: string[], warnings: string[]}>}
 */
export async function zorgVoorVelden({ asana, map, workspaceGid, projectGid, planningGid = null, deadlinesGid = null }) {
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

  // Sommige velden horen ook in een ander project: het planningsproject ("4. Werkplanning") en het
  // deadlineproject. Alleen velden die aan een project hangen kun je daar in de kalender als kleur
  // gebruiken, en alleen dan kan de function ze op een taak in dat project zetten.
  const veldenPerProject = new Map()
  async function koppelAan(extraGid, wat, field) {
    if (!extraGid) return
    try {
      if (!veldenPerProject.has(extraGid)) {
        const s = await asana(`/projects/${extraGid}/custom_field_settings?limit=100&opt_fields=custom_field.gid`)
        veldenPerProject.set(extraGid, new Set(s.map((x) => x.custom_field?.gid).filter(Boolean)))
      }
      const al = veldenPerProject.get(extraGid)
      if (al.has(field.gid)) return
      await asana(`/projects/${extraGid}/addCustomFieldSetting`, { method: 'POST', body: { data: { custom_field: field.gid, is_important: false } } })
      al.add(field.gid)
      summary.push(`Veld "${field.name}" ook aan het ${wat} gekoppeld (voor de kleur in de kalender)`)
    } catch (e) {
      warnings.push(`Veld "${field.name}" kon niet aan het ${wat} gekoppeld worden: ${e.message}`)
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
      if (spec.ookInPlanning) await koppelAan(planningGid, 'planningsproject', { gid: field.gid, name })
      if (spec.ookInDeadlines) await koppelAan(deadlinesGid, 'deadlineproject', { gid: field.gid, name })
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

