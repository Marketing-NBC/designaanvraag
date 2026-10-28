import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import type { AsanaFieldsConfig, AsanaTask, AsanaTaskClient } from '../_shared/asana.ts'
import type { AanvraagDetail, OpleveringRow } from '../_shared/db.ts'
import type { MailBericht } from '../_shared/shared/mail.ts'
import type { AsanaBestand, Reactie } from '../_shared/shared/oplevering.ts'
import { createOplever, type OpleverDeps } from './oplevering.ts'

const cfg: AsanaFieldsConfig = {
  project: { gid: 'proj1' },
  assignee: { gid: 'abel' },
  fields: {
    oplevermail: {
      gid: 'veld-oplever',
      name: 'Oplevermail',
      type: 'enum',
      options: { verstuur: 'opt-verstuur', bezig: 'opt-bezig', verstuurd: 'opt-verstuurd', mislukt: 'opt-mislukt' },
    },
    ook_mailen_naar: { gid: 'veld-ook', name: 'Ook mailen naar', type: 'text' },
  },
  sections: { klaar: { gid: 'sec-klaar' } },
}

const NU = new Date('2026-10-28T10:00:00Z')

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

function reactie(over: Partial<Reactie> = {}): Reactie {
  return {
    gid: 'story-1',
    createdAt: '2026-10-28T09:55:00Z',
    tekst: 'Oplevering: hierbij het torenscherm.',
    html: '<body><strong>Oplevering:</strong> hierbij het torenscherm.</body>',
    auteurGid: 'devi',
    auteurNaam: 'Devi',
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
  reacties?: Reactie[]
  bestanden?: AsanaBestand[]
  email?: string | null
  aanvraag?: AanvraagDetail | null
  eerder?: OpleveringRow | null
  verstuurd?: number
  mailFout?: string
  zonderMail?: boolean
} = {}) {
  const comments: string[] = []
  const velden: Record<string, unknown>[] = []
  const afgerond: string[] = []
  const gemaild: MailBericht[] = []
  const rijen: OpleveringRow[] = opts.eerder ? [opts.eerder] : []
  const downloads: string[] = []

  const asana = {
    listReacties: () => Promise.resolve(opts.reacties ?? [reactie()]),
    listBestanden: () => Promise.resolve(opts.bestanden ?? [bestand()]),
    downloadBestand: (gid: string) => {
      downloads.push(gid)
      const b = (opts.bestanden ?? [bestand()]).find((x) => x.gid === gid)
      return Promise.resolve({ bytes: new Uint8Array(b?.bytes ?? 10), mime: 'image/png' })
    },
    addComment: (_gid: string, html: string) => (comments.push(html), Promise.resolve()),
    updateCustomFields: (_gid: string, v: Record<string, unknown>) => (velden.push(v), Promise.resolve([])),
    rondAf: (gid: string, sectie: string | null) => (afgerond.push(`${gid}:${sectie}`), Promise.resolve()),
  } as unknown as AsanaTaskClient

  const db: OpleverDeps['db'] = {
    findDetailByAsanaTaskGid: () => Promise.resolve(opts.aanvraag === undefined ? aanvraag : opts.aanvraag),
    collegaEmail: () => Promise.resolve(opts.email === undefined ? 'britt@nbcevents.nl' : opts.email),
    findOplevering: (gid) => Promise.resolve(rijen.find((r) => r.comment_gid === gid) ?? null),
    aantalVerstuurd: () => Promise.resolve(opts.verstuurd ?? 0),
    insertOplevering: (r) => {
      const rij: OpleveringRow = { ...r, id: `op-${rijen.length + 1}`, created_at: NU.toISOString(), status: 'bezig', fout: null, verstuurd_op: null }
      rijen.push(rij)
      return Promise.resolve(rij)
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
  return { oplever, comments, velden, afgerond, gemaild, rijen, downloads }
}

Deno.test('de reactie wordt de mail: aan de aanvrager, met de bestanden en een feedbackknop', async () => {
  const s = setup()
  const uitkomst = await s.oplever(taak())

  assertEquals(uitkomst, 'oplevermail verstuurd (versie 1)')
  assertEquals(s.gemaild.length, 1)
  const m = s.gemaild[0]
  assertEquals(m.aan, ['britt@nbcevents.nl'])
  assertEquals(m.antwoordAan, ['marketing@nbcevents.nl'], 'een antwoord verdwijnt niet in een postvak dat niemand leest')
  assertEquals(m.onderwerp, 'Klaar: Zorgcongres - 11 december - Torenscherm')
  assertEquals(m.bijlagen?.map((b) => b.naam), ['torenscherm.png'])
  assertStringIncludes(m.html, 'hierbij het torenscherm.')
  assert(!/Oplevering:/.test(m.html), 'het woord Oplevering: zelf hoort niet in de mail')
  assertStringIncludes(m.html, `?feedback=${aanvraag.id}`)
})

Deno.test('na het versturen: verslag in Asana, veld op Verstuurd, taak naar Klaar', async () => {
  const s = setup()
  await s.oplever(taak())
  assertMatch(s.comments[0], /Opleveringsmail verstuurd op 28 oktober 2026 aan britt@nbcevents\.nl\. Bijlagen: torenscherm\.png\./)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-verstuurd' }])
  assertEquals(s.afgerond, ['t1:sec-klaar'])
  assertEquals(s.rijen[0].status, 'verstuurd')
  assertEquals(s.rijen[0].versie, 1)
})

Deno.test('"Ook mailen naar" komt erbij, zonder dubbelen', async () => {
  const s = setup()
  await s.oplever(taak(ook('jan@klant.nl, Britt@NBCevents.nl; Piet <piet@klant.nl>')))
  assertEquals(s.gemaild[0].aan, ['britt@nbcevents.nl', 'jan@klant.nl', 'piet@klant.nl'])
})

Deno.test('zonder adres bij de aanvrager gaan alleen de extra adressen mee', async () => {
  const s = setup({ email: null })
  await s.oplever(taak(ook('jan@klant.nl')))
  assertEquals(s.gemaild[0].aan, ['jan@klant.nl'])
})

Deno.test('helemaal geen ontvanger: niets verstuurd, met uitleg en vermelding', async () => {
  const s = setup({ email: null })
  const uitkomst = await s.oplever(taak())
  assertMatch(uitkomst, /niet verstuurd/)
  assertEquals(s.gemaild, [])
  assertMatch(s.comments[0], /data-asana-gid="devi"/)
  assertMatch(s.comments[0], /bij Britt staat geen e-mailadres/)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-mislukt' }])
  assertEquals(s.afgerond, [])
})

Deno.test('een verkeerd adres houdt de hele mail tegen', async () => {
  const s = setup()
  await s.oplever(taak(ook('jan@klant.nl, piet-at-klant')))
  assertEquals(s.gemaild, [])
  assertMatch(s.comments[0], /piet-at-klant/)
})

Deno.test('zonder reactie "Oplevering:" gaat er niets uit', async () => {
  const s = setup({ reacties: [reactie({ tekst: 'Bijna klaar!', html: '<body>Bijna klaar!</body>' })] })
  await s.oplever(taak())
  assertEquals(s.gemaild, [])
  assertMatch(s.comments[0], /begint met &quot;Oplevering:&quot;|begint met "Oplevering:"/)
  // Niemand schreef een Oplevering-reactie; dan krijgt de eigenaar van de taak de vermelding.
  assertMatch(s.comments[0], /data-asana-gid="abel"/)
})

Deno.test('de nieuwste Oplevering-reactie telt, met alleen de bestanden van dat moment', async () => {
  const s = setup({
    reacties: [
      reactie({ gid: 'oud', createdAt: '2026-10-20T09:00:00Z', tekst: 'Oplevering: eerste versie', html: '<body>Oplevering: eerste versie</body>' }),
      reactie({ gid: 'nieuw', createdAt: '2026-10-28T09:55:00Z', tekst: 'oplevering : tweede versie', html: '<body>oplevering : tweede versie</body>' }),
    ],
    bestanden: [
      bestand({ gid: 'logo', naam: 'logo-opdrachtgever.png', createdAt: '2026-10-01T08:00:00Z' }),
      bestand({ gid: 'v1', naam: 'versie1.png', createdAt: '2026-10-20T08:59:00Z' }),
      bestand({ gid: 'v2', naam: 'versie2.png', createdAt: '2026-10-28T09:40:00Z' }),
      bestand({ gid: 'map', naam: 'Ontwerpen', host: 'onedrive', bytes: null, viewUrl: 'https://onedrive.example/map', createdAt: '2026-10-28T09:56:00Z' }),
    ],
  })
  await s.oplever(taak())
  assertEquals(s.downloads, ['v2'])
  assertStringIncludes(s.gemaild[0].html, 'tweede versie')
  assertStringIncludes(s.gemaild[0].html, 'https://onedrive.example/map')
  assertEquals(s.rijen[0].comment_gid, 'nieuw')
})

Deno.test('na eerdere opleveringen heet het versie 2', async () => {
  const s = setup({ verstuurd: 1 })
  await s.oplever(taak())
  assertMatch(s.gemaild[0].onderwerp, /^Versie 2 klaar: Zorgcongres/)
  assertMatch(s.comments[0], /versie 2/)
})

Deno.test('dezelfde reactie gaat geen tweede keer de deur uit', async () => {
  const eerder: OpleveringRow = {
    id: 'op-1', created_at: '2026-10-27T10:00:00Z', aanvraag_id: aanvraag.id, comment_gid: 'story-1', versie: 1,
    ontvangers: ['britt@nbcevents.nl'], bijlagen: [], status: 'verstuurd', fout: null, verstuurd_op: '2026-10-27T10:00:00Z',
  }
  const s = setup({ eerder })
  await s.oplever(taak())
  assertEquals(s.gemaild, [])
  assertMatch(s.comments[0], /al verstuurd/)
})

Deno.test('een tweede druk terwijl de eerste nog loopt doet niets', async () => {
  const eerder: OpleveringRow = {
    id: 'op-1', created_at: '2026-10-28T09:59:00Z', aanvraag_id: aanvraag.id, comment_gid: 'story-1', versie: 1,
    ontvangers: [], bijlagen: [], status: 'bezig', fout: null, verstuurd_op: null,
  }
  const s = setup({ eerder })
  assertEquals(await s.oplever(taak()), 'oplevermail al bezig')
  assertEquals(s.gemaild, [])
  assertEquals(s.comments, [])
  assertEquals(s.velden, [])
})

Deno.test('na een mislukte poging kan dezelfde reactie opnieuw', async () => {
  const eerder: OpleveringRow = {
    id: 'op-1', created_at: '2026-10-28T09:00:00Z', aanvraag_id: aanvraag.id, comment_gid: 'story-1', versie: 1,
    ontvangers: [], bijlagen: [], status: 'mislukt', fout: 'geen ontvanger', verstuurd_op: null,
  }
  const s = setup({ eerder })
  await s.oplever(taak())
  assertEquals(s.gemaild.length, 1)
  assertEquals(s.rijen.length, 1, 'dezelfde rij, geen tweede')
  assertEquals(s.rijen[0].status, 'verstuurd')
})

Deno.test('te grote bestanden: niets verstuurd, met de grootte en wat je dan doet', async () => {
  const s = setup({ bestanden: [bestand({ bytes: 15_000_000 }), bestand({ gid: 'att-2', naam: 'vlag.pdf', bytes: 9_000_000 })] })
  await s.oplever(taak())
  assertEquals(s.gemaild, [])
  assertEquals(s.downloads, [], 'eerst kijken, dan pas downloaden')
  assertMatch(s.comments[0], /samen 22,9 MB/)
  assertMatch(s.comments[0], /schijf of in SharePoint/)
})

Deno.test('een weigering van Microsoft wordt Mislukt, en de taak blijft staan', async () => {
  const s = setup({ mailFout: 'Mail versturen mislukt (403: ErrorAccessDenied)' })
  await s.oplever(taak())
  assertMatch(s.comments[0], /Microsoft weigerde de mail/)
  assertEquals(s.velden, [{ 'veld-oplever': 'opt-mislukt' }])
  assertEquals(s.afgerond, [])
  assertEquals(s.rijen[0].status, 'mislukt')
})

Deno.test('zonder ingestelde mail of zonder aanvraag blijft het niet stil', async () => {
  const zonderMail = setup({ zonderMail: true })
  await zonderMail.oplever(taak())
  assertMatch(zonderMail.comments[0], /Mail instellen/)

  const handmatig = setup({ aanvraag: null })
  await handmatig.oplever(taak())
  assertMatch(handmatig.comments[0], /hoort niet bij een aanvraag uit het formulier/)
})
