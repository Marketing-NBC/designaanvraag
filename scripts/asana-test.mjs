#!/usr/bin/env node
/**
 * End-to-end test van de koppeling formulier → edge function → Asana.
 *
 *   ASANA_PAT=... node --experimental-strip-types scripts/asana-test.mjs --base https://<ref>.supabase.co
 *
 * Wat hij doet: vier testaanvragen versturen naar de live function (precies zoals het formulier),
 * de aangemaakte taken terugleden uit Asana en controleren op titel, sectie, assignee, custom fields,
 * subtaken en beschrijving. Daarna de planning-flow: taak naar "In planning" (verwacht: comment met
 * de vraag om een vervaldatum), vervaldatum zetten (verwacht: taak ook in het planningsproject).
 * Ruimt zijn eigen testtaken daarna op.
 *
 * Opties:
 *   --base <url>      Supabase-project-URL; anders env SUPABASE_URL of SUPABASE_PROJECT_ID.
 *   --geen-planning   Sla de planning-flow over (scheelt ~1 minuut wachten).
 *   --behoud          Testtaken niet verwijderen, zodat je ze zelf kunt bekijken.
 *
 * Exitcode 1 als een controle faalt.
 */
import fields from '../shared/asana-fields.json' with { type: 'json' }
import { subtaskTitles, taskTitle } from '../shared/asana-title.ts'
import { isSpoed, vandaagInNl } from '../shared/spoed.ts'

const API = process.env.ASANA_API ?? 'https://app.asana.com/api/1.0'
const WACHT_MS = 120_000

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)

const pat = process.env.ASANA_PAT
if (!pat) fail('ASANA_PAT ontbreekt (env).')

const base = String(args.base ?? process.env.SUPABASE_URL ?? (process.env.SUPABASE_PROJECT_ID ? `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co` : '')).replace(/\/$/, '')
// http alleen lokaal, zodat je het script tegen een nagebouwde server kunt draaien.
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) {
  fail('Geef --base https://<project-ref>.supabase.co (of zet SUPABASE_URL).')
}

const projectGid = fields.project?.gid
if (!projectGid) fail('shared/asana-fields.json heeft geen project; draai eerst "Asana-velden vernieuwen".')

const regels = []
let mislukt = 0

function check(ok, omschrijving, detail = '') {
  regels.push(`${ok ? '✅' : '❌'} ${omschrijving}${detail ? ` — ${detail}` : ''}`)
  if (!ok) mislukt++
  return ok
}

function info(tekst) {
  regels.push(`ℹ️ ${tekst}`)
}

function fail(msg) {
  console.error(`Fout: ${msg}`)
  process.exit(1)
}

async function asana(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Asana ${init.method ?? 'GET'} ${path} → ${res.status}: ${(body.errors ?? []).map((e) => e.message).join('; ')}`)
  return body.data
}

const slaap = (ms) => new Promise((r) => setTimeout(r, ms))

function datum(dagenVanafNu) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + dagenVanafNu)
  return d.toISOString().slice(0, 10)
}

/** Wacht tot `probe()` waar is, of tot de tijd op is. Geeft terug of het gelukt is. */
async function wachtOp(probe, ms = WACHT_MS) {
  const eind = Date.now() + ms
  while (Date.now() < eind) {
    if (await probe()) return true
    await slaap(5_000)
  }
  return false
}

const scenarios = [
  {
    label: 'A. één type',
    aanvraag: {
      naam: 'Testaanvraag (automatisch)',
      event: 'TEST losse aanvraag',
      event_datum: datum(45),
      deadline: datum(30),
      website: 'https://www.nbccongrescentrum.nl/',
      schijf_locatie: 'G:\\Events\\2026\\TEST',
      aanvraag_types: ['torenscherm'],
      anders_tekst: '',
      design_modus: 'custom',
      omschrijving: 'Automatische test van de koppeling.',
    },
  },
  {
    label: 'B. meerdere types, inclusief "anders"',
    aanvraag: {
      naam: 'Testaanvraag (automatisch)',
      event: 'TEST meerdere designs',
      event_datum: datum(60),
      deadline: datum(20),
      website: 'https://www.greenvillage.nl/',
      schijf_locatie: '',
      aanvraag_types: ['led_kolom', 'vlaggen', 'menukaart_print', 'anders'],
      anders_tekst: 'Badges',
      design_modus: 'standaard',
      omschrijving: '',
    },
  },
  {
    label: 'C. spoedje (event binnen 10 werkdagen)',
    aanvraag: {
      naam: 'Testaanvraag (automatisch)',
      event: 'TEST spoedaanvraag',
      event_datum: datum(5),
      deadline: datum(3),
      website: 'https://www.nbccongrescentrum.nl/',
      schijf_locatie: '',
      aanvraag_types: ['koffiescherm'],
      anders_tekst: '',
      design_modus: 'standaard',
      omschrijving: 'Automatische test: dit hoort een spoedje te zijn.',
    },
  },
  {
    label: 'D. zonder website',
    aanvraag: {
      naam: 'Testaanvraag (automatisch)',
      event: 'TEST zonder website',
      event_datum: datum(70),
      deadline: datum(40),
      website: '',
      schijf_locatie: '',
      aanvraag_types: ['vlaggen'],
      anders_tekst: '',
      design_modus: 'standaard',
      omschrijving: 'Automatische test: geen website, dus geen huisstijl.',
    },
  },
]

/** Verstuurt een aanvraag zoals het formulier dat doet. */
async function verstuur(aanvraag, bijlageIds = []) {
  const res = await fetch(`${base}/functions/v1/submit-aanvraag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io' },
    body: JSON.stringify({
      aanvraag,
      client_request_id: crypto.randomUUID(),
      started_at: new Date(Date.now() - 60_000).toISOString(),
      bijlage_ids: bijlageIds,
      website_confirm: '',
    }),
    signal: AbortSignal.timeout(60_000),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const gemaakt = []

for (const s of scenarios) {
  regels.push(`\n**${s.label}**`)
  const { status, body } = await verstuur(s.aanvraag)
  if (!check(status === 200 && body.aanvraag_id, 'aanvraag geaccepteerd door submit-aanvraag', `HTTP ${status}${body.error ? `: ${body.error}` : ''}`)) continue
  if (!check(Boolean(body.asana_task_url), 'Asana-taak aangemaakt', body.asana_task_url ?? 'geen taak-url in de response')) continue

  // Taak-gid uit de permalink: ".../task/<gid>" of, bij oudere links, het laatste getal in de url.
  const url = String(body.asana_task_url)
  const gid = url.match(/\/task\/(\d+)/)?.[1] ?? url.split('/').filter((s) => /^\d+$/.test(s)).pop()
  gemaakt.push({ gid, url: body.asana_task_url, aanvraag: s.aanvraag, aanvraagId: body.aanvraag_id })

  const t = await asana(`/tasks/${gid}?opt_fields=name,notes,due_on,assignee.name,custom_fields,memberships.project.gid,memberships.section.gid,memberships.section.name`)

  check(t.name === taskTitle(s.aanvraag), 'taaknaam volgens afspraak', t.name)

  const lid = (t.memberships ?? []).find((m) => m.project?.gid === projectGid)
  check(lid?.section?.gid === fields.sections?.nieuwe_aanvragen?.gid, 'staat in de kolom "Nieuwe aanvragen"', lid?.section?.name ?? 'geen sectie')
  check(Boolean(t.assignee), 'heeft een assignee', t.assignee?.name ?? 'niemand')
  check(t.due_on === null || t.due_on === undefined, 'geen automatische vervaldatum', t.due_on ?? 'leeg')

  // Custom fields vergelijken op gid, niet op label: dat is ongevoelig voor hernoemde opties.
  const perGid = Object.fromEntries((t.custom_fields ?? []).map((c) => [c.gid, c]))
  const f = fields.fields ?? {}
  const veld = (sleutel) => perGid[f[sleutel]?.gid]

  check(veld('eventdatum')?.date_value?.date === s.aanvraag.event_datum, 'veld Eventdatum', veld('eventdatum')?.date_value?.date ?? 'leeg')
  check(veld('deadline')?.date_value?.date === s.aanvraag.deadline, 'veld Deadline', veld('deadline')?.date_value?.date ?? 'leeg')
  if (f.aanvrager?.type === 'enum') {
    // De testnaam staat niet in de collegalijst, dus hier hoort géén optie te komen: dat is precies
    // de bescherming tegen willekeurige invoer. Bij een echte aanvraag vult de function het veld wel.
    check(!veld('aanvrager')?.enum_value, 'veld Aanvrager leeg bij onbekende naam (bescherming werkt)', veld('aanvrager')?.enum_value?.name ?? 'leeg')
  } else {
    check(veld('aanvrager')?.text_value === s.aanvraag.naam, 'veld Aanvrager', veld('aanvrager')?.text_value ?? 'leeg')
  }
  if (s.aanvraag.website) {
    check(veld('website')?.text_value === s.aanvraag.website, 'veld Website', veld('website')?.text_value ?? 'leeg')
  } else {
    check(!veld('website')?.text_value, 'veld Website leeg zonder opgegeven site', veld('website')?.text_value ?? 'leeg')
  }

  const verwachteTypes = s.aanvraag.aanvraag_types.map((k) => f.type?.options?.[k]).filter(Boolean).sort()
  const gezetteTypes = (veld('type')?.multi_enum_values ?? []).map((v) => v.gid).sort()
  check(
    verwachteTypes.length === gezetteTypes.length && verwachteTypes.every((g, i) => g === gezetteTypes[i]),
    'veld Type aanvraag',
    (veld('type')?.multi_enum_values ?? []).map((v) => v.name).join(', ') || 'leeg',
  )
  check(veld('modus')?.enum_value?.gid === f.modus?.options?.[s.aanvraag.design_modus], 'veld Design', veld('modus')?.enum_value?.name ?? 'leeg')

  const spoedVerwacht = isSpoed(s.aanvraag.event_datum, vandaagInNl())
  if (!f.spoed) {
    check(false, 'veld Spoed', 'ontbreekt in asana-fields.json — draai eerst de workflow "Asana-project aanmaken"')
  } else {
    check(
      veld('spoed')?.enum_value?.gid === f.spoed.options?.[spoedVerwacht ? 'ja' : 'nee'],
      `veld Spoed (${spoedVerwacht ? 'ja' : 'nee'} verwacht)`,
      veld('spoed')?.enum_value?.name ?? 'leeg',
    )
  }

  if (s.aanvraag.schijf_locatie) {
    check(veld('schijf')?.text_value === s.aanvraag.schijf_locatie, 'veld Schijf', veld('schijf')?.text_value ?? 'leeg')
  }

  // Bleef een veld leeg, dan proberen we het hier zelf te zetten met dezelfde waarde als de
  // function. Asana's eigen foutmelding komt dan in het verslag: zonder die regel weet je alleen
  // dát het misging, niet waarom.
  const verwachteVelden = {
    eventdatum: { date: s.aanvraag.event_datum },
    deadline: { date: s.aanvraag.deadline },
    ...(f.aanvrager?.type === 'enum' ? {} : { aanvrager: s.aanvraag.naam }),
    ...(s.aanvraag.website ? { website: s.aanvraag.website } : {}),
    type: s.aanvraag.aanvraag_types.map((k) => f.type?.options?.[k]).filter(Boolean),
    modus: f.modus?.options?.[s.aanvraag.design_modus],
    ...(f.spoed ? { spoed: f.spoed.options?.[spoedVerwacht ? 'ja' : 'nee'] } : {}),
    ...(s.aanvraag.schijf_locatie ? { schijf: s.aanvraag.schijf_locatie } : {}),
  }
  for (const [sleutel, waarde] of Object.entries(verwachteVelden)) {
    const veldGid = f[sleutel]?.gid
    const c = veldGid ? perGid[veldGid] : null
    const leeg = !c || (!c.date_value && !c.text_value && !c.enum_value && !(c.multi_enum_values ?? []).length)
    if (!leeg) continue
    try {
      await asana(`/tasks/${gid}`, { method: 'PUT', body: { data: { custom_fields: { [veldGid]: waarde } } } })
      info(`veld "${sleutel}" was leeg, maar los zetten lukt wél — de function kreeg de waarde niet doorgezet`)
    } catch (e) {
      info(`Asana weigert veld "${sleutel}": ${e.message}`)
    }
  }

  const verwachteSubtaken = subtaskTitles(s.aanvraag)
  const subtaken = (await asana(`/tasks/${gid}/subtasks?opt_fields=name`)) ?? []
  check(
    subtaken.length === verwachteSubtaken.length && verwachteSubtaken.every((n) => subtaken.some((st) => st.name === n)),
    `subtaken (${verwachteSubtaken.length} verwacht)`,
    subtaken.map((st) => st.name).join(' | ') || 'geen',
  )

  const notes = String(t.notes ?? '')
  check(notes.includes(s.aanvraag.event), 'beschrijving bevat de aanvraaggegevens', `${notes.length} tekens`)
  check(notes.toLowerCase().includes('huisstijl'), 'beschrijving heeft de huisstijl-sectie')

  // Status-endpoint van het succes-scherm.
  const st = await fetch(`${base}/functions/v1/aanvraag-status?id=${body.aanvraag_id}`, { signal: AbortSignal.timeout(15_000) })
  const stBody = await st.json().catch(() => ({}))
  check(st.status === 200 && stBody.asana_task_url === body.asana_task_url, 'status-endpoint geeft de taak terug', `brand_status: ${stBody.brand_status ?? '?'}`)
  if (!s.aanvraag.website) {
    check(stBody.brand_status === 'overgeslagen', 'huisstijl overgeslagen zonder website', stBody.brand_status ?? '?')
  }
  if (stBody.brand_status === 'failed') info(`huisstijl-extractie staat op "failed": ${stBody.brand_error ?? 'geen reden'}`)
}

// Aanvulling-flow: zoeken op de eventnaam en er iets bij vragen. Op de eerste testtaak.
if (gemaakt.length) {
  const eerste = gemaakt[0]
  regels.push('\n**D. aanvulling op een bestaande aanvraag**')

  const zoekTerm = eerste.aanvraag.event.slice(0, 12)
  const zoekRes = await fetch(`${base}/functions/v1/aanvraag-zoeken?q=${encodeURIComponent(zoekTerm)}`, {
    headers: { Origin: 'https://marketing-nbc.github.io' },
    signal: AbortSignal.timeout(20_000),
  })
  const zoekBody = await zoekRes.json().catch(() => ({}))
  const gevonden = (zoekBody.resultaten ?? []).find((r) => r.id === eerste.aanvraagId)
  check(zoekRes.status === 200 && Boolean(gevonden), 'aanvraag is terug te vinden op eventnaam', `HTTP ${zoekRes.status}, ${(zoekBody.resultaten ?? []).length} treffer(s)`)

  const kort = await fetch(`${base}/functions/v1/aanvraag-zoeken?q=ab`, { headers: { Origin: 'https://marketing-nbc.github.io' }, signal: AbortSignal.timeout(20_000) })
  const kortBody = await kort.json().catch(() => ({}))
  check(kort.status === 200 && (kortBody.resultaten ?? []).length === 0, 'twee letters leveren niets op')

  // De taak eerst afronden: naar Klaar en afvinken. Zo bewijst dit scenario meteen dat een
  // aanvulling op afgerond werk de taak terugtrekt in beeld.
  const klaarGid = fields.sections?.klaar?.gid
  const feedbackGid = fields.sections?.feedback?.gid
  if (klaarGid) {
    await asana(`/sections/${klaarGid}/addTask`, { method: 'POST', body: { data: { task: eerste.gid } } })
    await asana(`/tasks/${eerste.gid}`, { method: 'PUT', body: { data: { completed: true, due_on: eerste.aanvraag.deadline } } })
  } else {
    info('sectie "klaar" staat niet in asana-fields.json; heropenen niet getest')
  }

  // Een type dat nog niet op de taak staat, zodat de unie aantoonbaar is.
  const erbij = ['vlaggen', 'menukaart_print', 'koffiescherm'].find((k) => !eerste.aanvraag.aanvraag_types.includes(k))
  const typeVeldGid = fields.fields?.type?.gid
  const voor = await asana(`/tasks/${eerste.gid}?opt_fields=custom_fields`)
  const voorGids = (voor.custom_fields ?? []).find((c) => c.gid === typeVeldGid)?.multi_enum_values?.map((o) => o.gid) ?? []

  const aanvullingPayload = {
    aanvulling: {
      aanvraag_id: eerste.aanvraagId,
      naam: eerste.aanvraag.naam,
      toelichting: 'TEST — aanvulling via de end-to-end test. Er komt een extra type bij.',
      extra_types: erbij ? [erbij] : [],
      link: 'wetransfer.com/test-aanvulling',
    },
    client_request_id: crypto.randomUUID(),
    started_at: new Date(Date.now() - 60_000).toISOString(),
    website_confirm: '',
  }
  const aRes = await fetch(`${base}/functions/v1/aanvulling-toevoegen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io' },
    body: JSON.stringify(aanvullingPayload),
    signal: AbortSignal.timeout(30_000),
  })
  const aBody = await aRes.json().catch(() => ({}))
  check(aRes.status === 200 && Boolean(aBody.aanvulling_id), 'aanvulling geaccepteerd', `HTTP ${aRes.status}${aBody.error ? `: ${aBody.error}` : ''}`)

  if (aRes.status === 200) {
    const stories = (await asana(`/tasks/${eerste.gid}/stories?limit=100&opt_fields=text,resource_subtype`)) ?? []
    const comment = stories.find((st) => st.resource_subtype === 'comment_added' && String(st.text ?? '').includes('Aanvulling van'))
    check(Boolean(comment), 'reactie staat onder de bestaande taak', comment ? String(comment.text).slice(0, 80) : 'geen reactie gevonden')
    check(stories.filter((st) => st.resource_subtype === 'comment_added' && String(st.text ?? '').includes('Aanvulling van')).length === 1, 'precies één reactie, geen tweede taak')

    if (erbij && typeVeldGid) {
      const na = await asana(`/tasks/${eerste.gid}?opt_fields=custom_fields`)
      const naGids = (na.custom_fields ?? []).find((c) => c.gid === typeVeldGid)?.multi_enum_values?.map((o) => o.gid) ?? []
      const erbijGid = fields.fields?.type?.options?.[erbij]
      check(voorGids.every((g) => naGids.includes(g)), 'bestaande types zijn blijven staan', `voor ${voorGids.length}, na ${naGids.length}`)
      check(naGids.includes(erbijGid), `"${erbij}" is erbij gekomen`, naGids.join(', '))
      check((aBody.bijgewerkt ?? []).length > 0, 'de function meldt welk veld is bijgewerkt', (aBody.bijgewerkt ?? []).join(', ') || 'niets')
    }

    if (klaarGid) {
      const na = await asana(`/tasks/${eerste.gid}?opt_fields=completed,due_on,memberships.project.gid,memberships.section.gid,memberships.section.name`)
      const onze = (na.memberships ?? []).find((m) => m.project?.gid === projectGid)
      check(na.completed === false, 'het vinkje is eraf', String(na.completed))
      check(!na.due_on, 'de planningsdatum is eraf', na.due_on ?? 'leeg')
      if (feedbackGid) {
        check(onze?.section?.gid === feedbackGid, 'de taak staat in de kolom Feedback', onze?.section?.name ?? 'geen sectie')
      } else {
        info('kolom "Feedback" staat nog niet in asana-fields.json; draai eerst Asana-project aanmaken en Asana-velden ophalen')
      }
      check(String(comment?.text ?? '').includes('heropend'), 'de reactie meldt dat de taak heropend is')
    }

    // Nog een keer versturen met dezelfde client_request_id levert geen tweede reactie op.
    const nogmaals = await fetch(`${base}/functions/v1/aanvulling-toevoegen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io' },
      body: JSON.stringify(aanvullingPayload),
      signal: AbortSignal.timeout(30_000),
    })
    const naHerhaling = (await asana(`/tasks/${eerste.gid}/stories?limit=100&opt_fields=text,resource_subtype`)) ?? []
    const aantal = naHerhaling.filter((st) => st.resource_subtype === 'comment_added' && String(st.text ?? '').includes('Aanvulling van')).length
    check(nogmaals.status === 200 && aantal === 1, 'herhaald versturen plaatst geen tweede reactie', `${aantal} reactie(s)`)
  }
}

// Bijlagen: uploadlink vragen, rechtstreeks naar Storage uploaden, en kijken of het bestand als
// bijlage bij de taak belandt. Dit scenario bewijst het deel van de opzet dat je met de hand niet
// kunt nagaan: of de browser echt rechtstreeks mag uploaden vanaf de github.io-pagina.
{
  regels.push('\n**E. bestanden meesturen**')

  // Twee kleine, echte bestanden. Geen fixtures op schijf nodig.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
  const bestanden = [
    { naam: 'TEST-logo.png', type: 'image/png', bytes: png },
    { naam: 'TEST-voorbeeld.pdf', type: 'application/pdf', bytes: pdf },
  ]

  const groepId = crypto.randomUUID()
  const linkRes = await fetch(`${base}/functions/v1/bijlage-uploadlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io' },
    body: JSON.stringify({
      doel: 'aanvraag',
      groep_id: groepId,
      bestanden: bestanden.map((b) => ({ naam: b.naam, type: b.type, grootte: b.bytes.length })),
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const linkBody = await linkRes.json().catch(() => ({}))
  const links = linkBody.links ?? []
  check(linkRes.status === 200 && links.length === 2, 'uploadlinks gekregen', `HTTP ${linkRes.status}${linkBody.error ? `: ${linkBody.error}` : ''}`)

  // Een verboden type hoort hier al te stranden.
  const verboden = await fetch(`${base}/functions/v1/bijlage-uploadlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io' },
    body: JSON.stringify({
      doel: 'aanvraag',
      groep_id: crypto.randomUUID(),
      bestanden: [{ naam: 'ontwerp.psd', type: 'image/vnd.adobe.photoshop', grootte: 1000 }],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  check(verboden.status === 400, 'design-bronbestand wordt geweigerd', `HTTP ${verboden.status}`)

  let geuploaded = 0
  for (const [i, link] of links.entries()) {
    const b = bestanden[i]
    // Precies wat de browser doet: PUT naar de link, zonder sleutel, met het type erbij.
    const put = await fetch(link.signed_url, {
      method: 'PUT',
      headers: { 'Content-Type': b.type, 'Cache-Control': 'max-age=3600' },
      body: b.bytes,
      signal: AbortSignal.timeout(60_000),
    })
    if (put.ok) geuploaded++
    else info(`upload van ${b.naam} mislukt: HTTP ${put.status} ${(await put.text()).slice(0, 200)}`)
  }
  check(geuploaded === links.length, 'bestanden rechtstreeks naar Storage geüpload', `${geuploaded} van ${links.length}`)

  if (geuploaded === links.length) {
    const aanvraagMetBijlagen = {
      ...scenarios[0].aanvraag,
      event: 'TEST bijlagen automatische test',
    }
    const { status, body } = await verstuur(aanvraagMetBijlagen, links.map((l) => l.bijlage_id))
    check(status === 200 && body.asana_task_url, 'aanvraag met bijlagen geaccepteerd', `HTTP ${status}${body.error ? `: ${body.error}` : ''}`)

    if (body.asana_task_url) {
      const url = String(body.asana_task_url)
      const gid = url.match(/\/task\/(\d+)/)?.[1] ?? url.split('/').filter((x) => /^\d+$/.test(x)).pop()
      gemaakt.push({ gid, url, aanvraag: aanvraagMetBijlagen, aanvraagId: body.aanvraag_id })

      // wachtOp geeft alleen true of false terug, dus de namen halen we er daarna zelf bij op.
      const gelukt = await wachtOp(async () => ((await asana(`/attachments?parent=${gid}&opt_fields=name`)) ?? []).length >= 2)
      const namen = ((await asana(`/attachments?parent=${gid}&opt_fields=name`)) ?? []).map((a) => a.name)
      check(gelukt, 'beide bestanden staan als bijlage bij de taak', namen.join(', ') || 'geen bijlagen binnen de wachttijd')
      check(namen.includes('TEST-logo.png') && namen.includes('TEST-voorbeeld.pdf'), 'de bijlagen hebben de namen die de collega gaf', namen.join(', '))

      const taak = await asana(`/tasks/${gid}?opt_fields=notes`)
      check(String(taak.notes ?? '').includes('TEST-logo.png'), 'de beschrijving noemt de meegestuurde bestanden')

      const st = await fetch(`${base}/functions/v1/aanvraag-status?id=${body.aanvraag_id}`, { signal: AbortSignal.timeout(15_000) })
      const stBody = await st.json().catch(() => ({}))
      if (stBody.brand_error) info(`let op: ${stBody.brand_error}`)
    }
  }
}

// Planning-flow: alleen op de eerste testtaak.
if (args['geen-planning'] !== 'true' && gemaakt.length) {
  const { gid, aanvraag } = gemaakt[0]
  const inPlanning = fields.sections?.in_planning?.gid
  const planningGid = fields.planning_project?.gid
  regels.push('\n**F. planning-flow (webhook)**')

  if (!inPlanning || !planningGid) {
    check(false, 'secties en planningsproject staan in asana-fields.json')
  } else {
    await asana(`/sections/${inPlanning}/addTask`, { method: 'POST', body: { data: { task: gid } } })
    const gevraagd = await wachtOp(async () => {
      const stories = (await asana(`/tasks/${gid}/stories?limit=100&opt_fields=text,resource_subtype`)) ?? []
      return stories.some((s) => s.resource_subtype === 'comment_added' && String(s.text ?? '').toLowerCase().includes('kies een vervaldatum'))
    })
    check(gevraagd, 'taak naar "In planning" → webhook vraagt om een vervaldatum')

    await asana(`/tasks/${gid}`, { method: 'PUT', body: { data: { due_on: aanvraag.deadline } } })
    const ingepland = await wachtOp(async () => {
      const t = await asana(`/tasks/${gid}?opt_fields=projects.gid`)
      return (t.projects ?? []).some((p) => p.gid === planningGid)
    })
    check(ingepland, `vervaldatum gezet → taak staat ook in "${fields.planning_project?.name ?? 'het planningsproject'}"`)

    if (ingepland) {
      const stories = (await asana(`/tasks/${gid}/stories?limit=100&opt_fields=text,resource_subtype`)) ?? []
      check(stories.some((s) => s.resource_subtype === 'comment_added' && String(s.text ?? '').startsWith('Ingepland:')), 'bevestigings-comment geplaatst')
    }
  }
}

// Opruimen: de testtaken weer weg (subtaken gaan mee).
regels.push('')
if (args.behoud === 'true') {
  info(`testtaken blijven staan: ${gemaakt.map((g) => g.url).join(' , ')}`)
} else {
  for (const g of gemaakt) {
    try {
      await asana(`/tasks/${g.gid}`, { method: 'DELETE' })
      info(`testtaak ${g.gid} verwijderd`)
    } catch (e) {
      info(`testtaak ${g.gid} kon niet verwijderd worden: ${e.message}`)
    }
  }
  info('de rijen in de Supabase-tabellen blijven staan; die mag je met de hand weggooien')
  info('de geüploade testbestanden ruimt scripts/bijlagen-opruimen.mjs vanzelf op')
}

const kop = mislukt === 0 ? '### Asana-test geslaagd' : `### Asana-test: ${mislukt} controle(s) mislukt`
const verslag = [kop, '', ...regels].join('\n')
console.log(verslag)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${verslag}\n`)
}
process.exit(mislukt === 0 ? 0 : 1)
