import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import type { AsanaFieldsConfig, AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import type { AanvraagDetail, OpleveringRow } from '../_shared/db.ts'
import type { MailBericht } from '../_shared/shared/mail.ts'
import type { AsanaBestand, Subtaak } from '../_shared/shared/oplevering.ts'
import { createOplever, type OpleverDeps } from './oplevering.ts'

const cfg: AsanaFieldsConfig = {
  project: { gid: 'proj1' },
  assignee: { gid: 'abel' },
  fields: {
    oplevermail: {
      gid: 'veld-oplever',
      name: 'Oplevermail',
      type: 'enum',
      options: {
        proef: 'opt-proef', verstuur: 'opt-verstuur', bezig: 'opt-bezig',
        proef_verstuurd: 'opt-proef-verstuurd', verstuurd: 'opt-verstuurd', mislukt: 'opt-mislukt',
      },
    },
    ook_mailen_naar: { gid: 'veld-ook', name: 'Ook mailen naar', type: 'text' },
  },
  sections: { klaar: { gid: 'sec-klaar' } },
}

const NU = new Date('2026-10-28T10:00:00Z')
const ECHT = { proef: false, door: 'devi' }
const PROEF = { proef: true, door: 'devi' }

const aanvraag = {
  id: '11111111-2222-4333-8444-555555555555',
  naam: 'Britt',
  locatie: 'nbc',
  soort: 'evenement',
  event: 'Zorgcongres',
  event_datum: '2026-12-11',
  deadline: '2026-12-01',
  aanvraag_types: ['torenscherm'],
  anders_tekst: '',
  schijf_locatie: '',
  omschrijving: '',
} as unknown as AanvraagDetail

function subtaak(over: Partial<Subtaak> = {}): Subtaak {
  return {
    gid: 'sub-1',
    naam: 'Oplevering',
    completed: false,
    createdAt: '2026-10-20T09:00:00Z',
    html: '<body>Hierbij het torenscherm.</body>',
    ...over,
  }
}

function bestand(over: Partial<AsanaBestand> = {}): AsanaBestand {
  return { gid: 'att-1', naam: 'torenscherm.png', bytes: 1000, createdAt: '2026-10-28T09:54:00Z', host: 'asana', viewUrl: null, ...over }
}

function taak(over: Partial<AsanaTask> = {}): AsanaTask {
  return {
    gid: 't1', name: 'Zorgcongres - 11 december - Britt', dueOn: null, completed: false, assignee: 'abel',
    projects: ['proj1'], memberships: [{ project: 'proj1', section: 'sec-bezig' }],
    customFields: { 'veld-oplever': { optieGids: ['opt-bezig'], datum: null, tekst: null } },
    ...over,
  }
}

function ook(tekst: string): Partial<AsanaTask> {
  return { customFields: { 'veld-ook': { optieGids: [], datum: null, tekst } } }
}

function setup(opts: {
  subtaken?: Subtaak[]
  /** Bijlagen per (sub)taak-gid; standaard één bestand op sub-1. */
  bestanden?: Record<string, AsanaBestand[]>
  email?: string | null
  aanvraag?: AanvraagDetail | null
  eerder?: OpleveringRow | null
  verstuurd?: number
  mailFout?: string
  zonderMail?: boolean
  gebruiker?: { naam: string | null; email: string | null } | 'fout'
  /**
   * Zoveel aanroepen lezen de oplevering voordat er één verder mag: zo zien twee gelijktijdige
   * aanroepen allebei dezelfde stand, zoals bij een dubbele levering van Asana.
   */
  gelijktijdig?: number
} = {}) {
  const comments: string[] = []
  const velden: Record<string, unknown>[] = []
  const afgerond: string[] = []
  const gemaild: MailBericht[] = []
  const rijen: OpleveringRow[] = opts.eerder ? [opts.eerder] : []
  const downloads: string[] = []
  const gemaakt: string[] = []
  const bijgewerkt: [string, { naam?: string; completed?: boolean }][] = []
  const bestanden = opts.bestanden ?? { 'sub-1': [bestand()] }
  let lezers = 0
  let conflicten = 0
  let iedereenGelezen = () => {}
  const gelezen = new Promise<void>((klaar) => (iedereenGelezen = klaar))

  const asana = {
    listSubtaken: () => Promise.resolve(opts.subtaken ?? [subtaak()]),
    maakSubtaak: (parent: string, naam: string, assignee: string | null) => (gemaakt.push(`${parent}:${naam}:${assignee}`), Promise.resolve('sub-nieuw')),
    werkTaakBij: (gid: string, stand: { naam?: string; completed?: boolean }) => (bijgewerkt.push([gid, stand]), Promise.resolve()),
    listBestanden: (gid: string) => Promise.resolve(bestanden[gid] ?? []),
    downloadBestand: (gid: string) => {
      downloads.push(gid)
      const b = Object.values(bestanden).flat().find((x) => x.gid === gid)
      return Promise.resolve({ bytes: new Uint8Array(b?.bytes ?? 10), mime: 'image/png' })
    },
    gebruiker: () => opts.gebruiker === 'fout'
      ? Promise.reject(new Error('403'))
      : Promise.resolve(opts.gebruiker ?? { naam: 'Devi de Vries', email: 'devi@nbcevents.nl' }),
    addComment: (_gid: string, html: string) => (comments.push(html), Promise.resolve()),
    updateCustomFields: (_gid: string, v: Record<string, unknown>) => (velden.push(v), Promise.resolve([])),
    rondAf: (gid: string, sectie: string | null) => (afgerond.push(`${gid}:${sectie}`), Promise.resolve()),
  } as unknown as AsanaTaskClient

  const db: OpleverDeps['db'] = {
    findDetailByAsanaTaskGid: () => Promise.resolve(opts.aanvraag === undefined ? aanvraag : opts.aanvraag),
    collegaEmail: () => Promise.resolve(opts.email === undefined ? 'britt@nbcevents.nl' : opts.email),
    findOplevering: async (gid) => {
      const gevonden = rijen.find((r) => r.subtaak_gid === gid) ?? null
      lezers++
      if (opts.gelijktijdig) {
        if (lezers === opts.gelijktijdig) iedereenGelezen()
        await gelezen
      }
      return gevonden ? { ...gevonden } : null
    },
    aantalVerstuurd: () => Promise.resolve(opts.verstuurd ?? 0),
    insertOplevering: (r) => {
      // Zoals de unieke sleutel op subtaak_gid: de db-laag maakt van die unique-violation null.
      if (rijen.some((x) => x.subtaak_gid === r.subtaak_gid)) {
        conflicten++
        return Promise.resolve(null)
      }
      const rij: OpleveringRow = { ...r, id: `op-${rijen.length + 1}`, created_at: NU.toISOString(), status: 'bezig', fout: null, verstuurd_op: null }
      rijen.push(rij)
      return Promise.resolve({ ...rij })
    },
    heropenOplevering: (oud, patch) => {
      const i = rijen.findIndex((r) => r.id === oud.id && r.status === oud.status && r.created_at === oud.created_at)
      if (i < 0) return Promise.resolve(false)
      rijen[i] = { ...rijen[i], ...patch }
      return Promise.resolve(true)
    },
    updateOplevering: (id, patch) => {
      const i = rijen.findIndex((r) => r.id === id)
      if (i >= 0) rijen[i] = { ...rijen[i], ...patch }
      return Promise.resolve()
    },
  }

  const mail = opts.zonderMail ? null : {
    verstuur: (b: MailBericht) => {
      if (opts.mailFout) return Promise.reject(new Error(opts.mailFout))
      gemaild.push(b)
      return Promise.resolve()
    },
  }

  const oplever = createOplever({ asana, db, mail, cfg, now: () => NU, log: () => {} })
  return { oplever, comments, velden, afgerond, gemaild, rijen, downloads, gemaakt, bijgewerkt, conflicten: () => conflicten }
}

// ── Echt versturen ────────────────────────────────────────────────────

Deno.test('de subtaak wordt de mail: beschrijving als tekst, bijlagen mee, feedbackknop erbij', async () => {
  const s = setup()
  const uitkomst = await s.oplever(taak(), ECHT)

  assertEquals(uitkomst, 'oplevermail verstuurd (versie 1)')
  assertEquals(s.gemaild.length, 1)
  const m = s.gemaild[0]
  assertEquals(m.aan, ['britt@nbcevents.nl'])
  assertEquals(m.antwoordAan, ['marketing@nbcevents.nl'], 'een antwoord verdwijnt niet in een postvak dat niemand leest')
  assertEquals(m.onderwerp, 'Klaar: Zorgcongres - 11 december - Torenscherm')
  assertEquals(m.bijlagen?.map((b) => b.naam), ['torenscherm.png'])
  assertStringIncludes(m.html, 'Hierbij het torenscherm.')
  assertStringIncludes(m.html, 'Devi de Vries, Marketing')
  assertStringIncludes(m.html, `?feedback=${aanvraag.id}`)
  assert(!m.html.includes('Proefmail'))
})

Deno.test('alleen de bijlagen van de subtaak gaan mee, niet die van de hoofdtaak', async () => {
  const s = setup({ bestanden: { 't1': [bestand({ gid: 'logo', naam: 'logo-opdrachtgever.png' })], 'sub-1': [bestand({ gid: 'v1' })] } })
  await s.oplever(taak(), ECHT)
  assertEquals(s.downloads, ['v1'])
})

Deno.test('na het versturen: verslag, veld op Verstuurd, subtaak afgevinkt, een nieuwe lege, taak naar Klaar', async () => {
  const s = setup()
  await s.oplever(taak(), ECHT)
  assertMatch(s.comments[0], /Opleveringsmail verstuurd op 28 oktober 2026 aan britt@nbcevents\.nl\. Bijlagen: torenscherm\.png\./)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-verstuurd' }])
  assertEquals(s.bijgewerkt, [['sub-1', { naam: 'Oplevering versie 1 - verstuurd 28 oktober', completed: true }]])
  assertEquals(s.gemaakt, ['t1:Oplevering:abel'])
  assertEquals(s.afgerond, ['t1:sec-klaar'])
  assertEquals(s.rijen[0].status, 'verstuurd')
  assertEquals(s.rijen[0].subtaak_gid, 'sub-1')
})

Deno.test('"Ook mailen naar" komt erbij, zonder dubbelen', async () => {
  const s = setup()
  await s.oplever(taak(ook('jan@klant.nl, Britt@NBCevents.nl; Piet <piet@klant.nl>')), ECHT)
  assertEquals(s.gemaild[0].aan, ['britt@nbcevents.nl', 'jan@klant.nl', 'piet@klant.nl'])
})

Deno.test('zonder adres bij de aanvrager gaan alleen de extra adressen mee', async () => {
  const s = setup({ email: null })
  await s.oplever(taak(ook('jan@klant.nl')), ECHT)
  assertEquals(s.gemaild[0].aan, ['jan@klant.nl'])
})

Deno.test('helemaal geen ontvanger: niets verstuurd, met uitleg en vermelding van wie drukte', async () => {
  const s = setup({ email: null })
  const uitkomst = await s.oplever(taak(), ECHT)
  assertMatch(uitkomst, /niet verstuurd/)
  assertEquals(s.gemaild, [])
  assertMatch(s.comments[0], /data-asana-gid="devi"/)
  assertMatch(s.comments[0], /bij Britt staat geen e-mailadres/)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-mislukt' }])
  assertEquals(s.afgerond, [])
  assertEquals(s.bijgewerkt, [])
})

Deno.test('een verkeerd adres houdt de hele mail tegen', async () => {
  const s = setup()
  await s.oplever(taak(ook('jan@klant.nl, piet-at-klant')), ECHT)
  assertEquals(s.gemaild, [])
  assertMatch(s.comments[0], /piet-at-klant/)
})

Deno.test('zonder open subtaak Oplevering: die wordt gemaakt, en er gaat niets uit', async () => {
  const s = setup({ subtaken: [subtaak({ naam: 'Oplevering versie 1 - verstuurd 20 oktober', completed: true }), subtaak({ gid: 'x', naam: 'Torenscherm' })] })
  await s.oplever(taak(), ECHT)
  assertEquals(s.gemaild, [])
  assertEquals(s.gemaakt, ['t1:Oplevering:abel'])
  assertMatch(s.comments[0], /subtaak &quot;Oplevering&quot;|subtaak "Oplevering"/)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-mislukt' }])
})

Deno.test('een lege subtaak gaat niet de deur uit', async () => {
  const s = setup({ subtaken: [subtaak({ html: '<body></body>' })], bestanden: {} })
  await s.oplever(taak(), ECHT)
  assertEquals(s.gemaild, [])
  assertMatch(s.comments[0], /nog leeg/)
})

Deno.test('alleen bestanden, zonder tekst, mag wel', async () => {
  const s = setup({ subtaken: [subtaak({ html: '<body></body>' })] })
  await s.oplever(taak(), ECHT)
  assertEquals(s.gemaild.length, 1)
})

Deno.test('een gekoppeld bestand gaat als link mee', async () => {
  const s = setup({ bestanden: { 'sub-1': [bestand({ gid: 'map', naam: 'Ontwerpen', host: 'onedrive', bytes: null, viewUrl: 'https://onedrive.example/map' })] } })
  await s.oplever(taak(), ECHT)
  assertEquals(s.downloads, [])
  assertStringIncludes(s.gemaild[0].html, 'https://onedrive.example/map')
  assertMatch(s.comments[0], /Als link: Ontwerpen\./)
})

Deno.test('na eerdere opleveringen heet het versie 2', async () => {
  const s = setup({ verstuurd: 1 })
  await s.oplever(taak(), ECHT)
  assertMatch(s.gemaild[0].onderwerp, /^Versie 2 klaar: Zorgcongres/)
  assertMatch(s.comments[0], /versie 2/)
  assertEquals(s.bijgewerkt[0][1].naam, 'Oplevering versie 2 - verstuurd 28 oktober')
})

Deno.test('dezelfde subtaak gaat geen tweede keer de deur uit', async () => {
  const eerder: OpleveringRow = {
    id: 'op-1', created_at: '2026-10-27T10:00:00Z', aanvraag_id: aanvraag.id, subtaak_gid: 'sub-1', versie: 1,
    ontvangers: ['britt@nbcevents.nl'], bijlagen: [], status: 'verstuurd', fout: null, verstuurd_op: '2026-10-27T10:00:00Z',
  }
  const s = setup({ eerder })
  await s.oplever(taak(), ECHT)
  assertEquals(s.gemaild, [])
  assertMatch(s.comments[0], /al verstuurd als versie 1/)
})

Deno.test('een tweede druk terwijl de eerste nog loopt doet niets', async () => {
  const eerder: OpleveringRow = {
    id: 'op-1', created_at: '2026-10-28T09:59:00Z', aanvraag_id: aanvraag.id, subtaak_gid: 'sub-1', versie: 1,
    ontvangers: [], bijlagen: [], status: 'bezig', fout: null, verstuurd_op: null,
  }
  const s = setup({ eerder })
  assertEquals(await s.oplever(taak(), ECHT), 'oplevermail al bezig')
  assertEquals(s.gemaild, [])
  assertEquals(s.comments, [])
  assertEquals(s.velden, [])
})

Deno.test('Asana levert "Verstuur nu" dubbel: één mail, één verslag, geen valse foutmelding', async () => {
  // 28 oktober, Zorgcongres: beide aanroepen zagen nog geen rij, de tweede liep vast op de unieke
  // sleutel en meldde "niet verstuurd" terwijl de mail wel ging.
  const s = setup({ gelijktijdig: 2 })
  const uitkomsten = await Promise.all([s.oplever(taak(), ECHT), s.oplever(taak(), ECHT)])

  assertEquals(s.conflicten(), 1, 'de tweede insert liep op de unieke sleutel')
  assertEquals(uitkomsten.sort(), ['oplevermail al bezig', 'oplevermail verstuurd (versie 1)'])
  assertEquals(s.gemaild.length, 1)
  assertEquals(s.downloads, ['att-1'], 'de tweede haalt ook geen bestanden op')
  assertEquals(s.comments.length, 1)
  assertMatch(s.comments[0], /Opleveringsmail verstuurd op 28 oktober 2026/)
  assert(!s.comments.some((c) => c.includes('niet</strong> verstuurd')))
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-verstuurd' }], 'nooit op Mislukt')
  assertEquals(s.rijen.length, 1)
  assertEquals(s.rijen[0].status, 'verstuurd')
  assertEquals(s.rijen[0].ontvangers, ['britt@nbcevents.nl'])
  assertEquals(s.gemaakt, ['t1:Oplevering:abel'], 'één nieuwe lege subtaak, niet twee')
})

Deno.test('ook een herkansing die Asana dubbel levert gaat maar één keer de deur uit', async () => {
  const eerder: OpleveringRow = {
    id: 'op-1', created_at: '2026-10-28T09:00:00Z', aanvraag_id: aanvraag.id, subtaak_gid: 'sub-1', versie: 1,
    ontvangers: [], bijlagen: [], status: 'mislukt', fout: 'geen ontvanger', verstuurd_op: null,
  }
  const s = setup({ eerder, gelijktijdig: 2 })
  const uitkomsten = await Promise.all([s.oplever(taak(), ECHT), s.oplever(taak(), ECHT)])

  assertEquals(uitkomsten.sort(), ['oplevermail al bezig', 'oplevermail verstuurd (versie 1)'])
  assertEquals(s.gemaild.length, 1)
  assertEquals(s.comments.length, 1)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-verstuurd' }])
  assertEquals(s.rijen.length, 1)
  assertEquals(s.rijen[0].status, 'verstuurd')
})

Deno.test('na een mislukte poging kan dezelfde subtaak opnieuw', async () => {
  const eerder: OpleveringRow = {
    id: 'op-1', created_at: '2026-10-28T09:00:00Z', aanvraag_id: aanvraag.id, subtaak_gid: 'sub-1', versie: 1,
    ontvangers: [], bijlagen: [], status: 'mislukt', fout: 'geen ontvanger', verstuurd_op: null,
  }
  const s = setup({ eerder })
  await s.oplever(taak(), ECHT)
  assertEquals(s.gemaild.length, 1)
  assertEquals(s.rijen.length, 1, 'dezelfde rij, geen tweede')
  assertEquals(s.rijen[0].status, 'verstuurd')
})

Deno.test('te grote bestanden: niets verstuurd, met de grootte en wat je dan doet', async () => {
  const s = setup({ bestanden: { 'sub-1': [bestand({ bytes: 15_000_000 }), bestand({ gid: 'att-2', naam: 'vlag.pdf', bytes: 9_000_000 })] } })
  await s.oplever(taak(), ECHT)
  assertEquals(s.gemaild, [])
  assertEquals(s.downloads, [], 'eerst kijken, dan pas downloaden')
  assertMatch(s.comments[0], /samen 22,9 MB/)
  assertMatch(s.comments[0], /schijf of in SharePoint/)
})

Deno.test('een weigering van Microsoft wordt Mislukt, en de taak blijft staan', async () => {
  const s = setup({ mailFout: 'Mail versturen mislukt (403: ErrorAccessDenied)' })
  await s.oplever(taak(), ECHT)
  assertMatch(s.comments[0], /Microsoft weigerde de mail/)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-mislukt' }])
  assertEquals(s.afgerond, [])
  assertEquals(s.bijgewerkt, [])
  assertEquals(s.rijen[0].status, 'mislukt')
})

Deno.test('zonder ingestelde mail of zonder aanvraag blijft het niet stil', async () => {
  const zonderMail = setup({ zonderMail: true })
  await zonderMail.oplever(taak(), ECHT)
  assertMatch(zonderMail.comments[0], /Mail instellen/)

  const handmatig = setup({ aanvraag: null })
  await handmatig.oplever(taak(), ECHT)
  assertMatch(handmatig.comments[0], /hoort niet bij een aanvraag uit het formulier/)
})

Deno.test('weten we niet wie drukte, dan vermeldt de foutmelding de eigenaar van de taak', async () => {
  const s = setup({ email: null })
  await s.oplever(taak(), { proef: false, door: null })
  assertMatch(s.comments[0], /data-asana-gid="abel"/)
})

// ── Proefmail ─────────────────────────────────────────────────────────

Deno.test('een proef gaat alleen naar wie drukte, met dezelfde inhoud', async () => {
  const s = setup()
  const uitkomst = await s.oplever(taak(ook('jan@klant.nl')), PROEF)
  assertEquals(uitkomst, 'proefmail verstuurd')
  const m = s.gemaild[0]
  assertEquals(m.aan, ['devi@nbcevents.nl'])
  assertMatch(m.onderwerp, /^\[PROEF\] Klaar: Zorgcongres/)
  assertStringIncludes(m.html, 'De echte mail gaat naar britt@nbcevents.nl en jan@klant.nl')
  assertStringIncludes(m.html, 'Hierbij het torenscherm.')
  assertEquals(m.bijlagen?.map((b) => b.naam), ['torenscherm.png'])
})

Deno.test('een proef telt niet en rondt niets af', async () => {
  const s = setup()
  await s.oplever(taak(), PROEF)
  assertEquals(s.rijen, [])
  assertEquals(s.bijgewerkt, [])
  assertEquals(s.gemaakt, [])
  assertEquals(s.afgerond, [])
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-proef-verstuurd' }])
  assertMatch(s.comments[0], /Proefmail gestuurd naar devi@nbcevents\.nl\. De echte mail gaat naar britt@nbcevents\.nl, met torenscherm\.png\./)
})

Deno.test('een proef van een al verstuurde versie mag gewoon', async () => {
  // Na het versturen staat er een nieuwe lege subtaak; maar ook als iemand de oude terugzet, is
  // een proef onschuldig.
  const eerder: OpleveringRow = {
    id: 'op-1', created_at: '2026-10-27T10:00:00Z', aanvraag_id: aanvraag.id, subtaak_gid: 'sub-1', versie: 1,
    ontvangers: [], bijlagen: [], status: 'verstuurd', fout: null, verstuurd_op: '2026-10-27T10:00:00Z',
  }
  const s = setup({ eerder })
  assertEquals(await s.oplever(taak(), PROEF), 'proefmail verstuurd')
})

Deno.test('weten we het adres van wie drukte niet, dan gaat de proef naar het marketingpostvak', async () => {
  const s = setup({ gebruiker: 'fout' })
  await s.oplever(taak(), PROEF)
  assertEquals(s.gemaild[0].aan, ['marketing@nbcevents.nl'])
  assert(!s.gemaild[0].html.includes(', Marketing</p>'), 'zonder naam geen ondertekening')
})

Deno.test('een mislukte proef zegt dat het om de proef ging', async () => {
  const s = setup({ email: null })
  await s.oplever(taak(), PROEF)
  assertMatch(s.comments[0], /De proefmail is <strong>niet<\/strong> verstuurd/)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-mislukt' }])
})
