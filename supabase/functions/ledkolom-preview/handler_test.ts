import { assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import type { AsanaTask } from '../_shared/asana.ts'
import type { AanvraagDetail, LedkolomPreviewRow, OpleveringRow } from '../_shared/db.ts'
import { createHandler } from './handler.ts'

const GEHEIM = 'een-lang-gedeeld-geheim'
const NU = new Date('2026-10-30T10:00:00Z')
const RELEASE = 'https://github.com/Marketing-NBC/NBC-3D-ledkolom-Preview/releases/tag/zorgcongres-11-dec'
const KLAAR = { naam: 'Zorgcongres - 11 dec', slug: 'zorgcongres-11-dec-0a1b2c3d' }

function rij(over: Partial<LedkolomPreviewRow> = {}): LedkolomPreviewRow {
  return {
    id: 'lk-1', aanvraag_id: 'a1', bron: RELEASE, status: 'wacht', fout: null, previews: [],
    gevraagd_op: '2026-10-30T09:55:00Z', klaar_op: null,
    ...over,
  }
}

function setup(opts: { previews?: LedkolomPreviewRow[]; wachtend?: Partial<OpleveringRow>[] } = {}) {
  const previews = (opts.previews ?? [rij()]).map((r) => ({ ...r }))
  const comments: string[] = []
  const opgeleverd: { taak: string; door: string | null; naPreview: boolean }[] = []
  const taak = { gid: 't1', assignee: 'abel' } as AsanaTask

  const handler = createHandler({
    geheim: GEHEIM,
    db: {
      openLedkolomPreviews: () => Promise.resolve(previews.filter((r) => r.status === 'wacht')),
      ledkolomPreview: (id) => Promise.resolve(previews.find((r) => r.id === id) ?? null),
      updateLedkolomPreview: (id, patch) => {
        const i = previews.findIndex((r) => r.id === id)
        previews[i] = { ...previews[i], ...patch }
        return Promise.resolve()
      },
      wachtendeOpleveringen: () => Promise.resolve((opts.wachtend ?? []) as OpleveringRow[]),
      findById: () => Promise.resolve({ id: 'a1', asana_task_gid: 't1' } as AanvraagDetail),
    },
    asana: {
      getTask: () => Promise.resolve(taak),
      addComment: (_gid, html) => (comments.push(html), Promise.resolve()),
    },
    oplever: (t, o) => (opgeleverd.push({ taak: t.gid, door: o.door, naPreview: o.naPreview }), Promise.resolve('oplevermail verstuurd (versie 1)')),
    now: () => NU,
    log: () => {},
  })

  const vraag = (init: RequestInit & { geheim?: string | null } = {}) => {
    const headers = new Headers(init.headers)
    if (init.geheim !== null) headers.set('Authorization', `Bearer ${init.geheim ?? GEHEIM}`)
    return handler(new Request('https://x.supabase.co/functions/v1/ledkolom-preview', { ...init, headers }))
  }
  const meld = (uitslagen: unknown[]) => vraag({ method: 'POST', body: JSON.stringify({ uitslagen }), headers: { 'Content-Type': 'application/json' } })
  return { vraag, meld, previews, comments, opgeleverd }
}

Deno.test('zonder of met een verkeerd geheim: geen toegang', async () => {
  const s = setup()
  assertEquals((await s.vraag({ geheim: null })).status, 401)
  assertEquals((await s.vraag({ geheim: 'fout' })).status, 401)
})

Deno.test('GET geeft de release-links die klaarstaan', async () => {
  const s = setup({ previews: [rij(), rij({ id: 'lk-2', bron: 'https://github.com/x', status: 'klaar' })] })
  const res = await s.vraag()
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { releases: [{ id: 'lk-1', bron: RELEASE }] })
})

Deno.test('klaar zonder wachtende mail: een reactie met de link', async () => {
  const s = setup()
  const res = await s.meld([{ id: 'lk-1', bron: RELEASE, status: 'klaar', previews: [KLAAR] }])
  assertEquals(await res.json(), { verwerkt: 1, verouderd: 0 })
  assertEquals(s.previews[0].status, 'klaar')
  assertEquals(s.previews[0].previews, [KLAAR])
  assertEquals(s.previews[0].klaar_op, NU.toISOString())
  assertStringIncludes(s.comments[0], 'https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/p/zorgcongres-11-dec-0a1b2c3d/')
  assertEquals(s.opgeleverd, [])
})

Deno.test('klaar met een wachtende mail: die gaat nu de deur uit, namens wie drukte', async () => {
  const s = setup({ wachtend: [{ id: 'op-1', door: 'devi', status: 'wacht_op_preview' }] })
  await s.meld([{ id: 'lk-1', bron: RELEASE, status: 'klaar', previews: [KLAAR] }])
  assertEquals(s.opgeleverd, [{ taak: 't1', door: 'devi', naPreview: true }])
  assertEquals(s.comments, [], 'het verslag komt uit de opleverflow')
})

Deno.test('mislukt zonder wachtende mail: een reactie met de reden en een vermelding', async () => {
  const s = setup()
  await s.meld([{ id: 'lk-1', bron: RELEASE, status: 'mislukt', fout: 'Release "zorgcongres-11-dec" niet gevonden.' }])
  assertEquals(s.previews[0].status, 'mislukt')
  assertMatch(s.comments[0], /data-asana-gid="abel"/)
  assertMatch(s.comments[0], /niet gevonden/)
})

Deno.test('mislukt met een wachtende mail: de opleverflow zet hem op Mislukt', async () => {
  const s = setup({ wachtend: [{ id: 'op-1', door: 'devi', status: 'wacht_op_preview' }] })
  await s.meld([{ id: 'lk-1', bron: RELEASE, status: 'mislukt', fout: 'kapot' }])
  assertEquals(s.opgeleverd.length, 1)
  assertEquals(s.comments, [])
})

Deno.test('klaar zonder previews telt als mislukt', async () => {
  const s = setup()
  await s.meld([{ id: 'lk-1', bron: RELEASE, status: 'klaar', previews: [] }])
  assertEquals(s.previews[0].status, 'mislukt')
})

Deno.test('een uitslag die al gemeld is of niet bij de link hoort, telt niet', async () => {
  const s = setup({ previews: [rij(), rij({ id: 'lk-2', status: 'klaar' })] })
  const res = await s.meld([
    { id: 'lk-1', bron: 'https://github.com/Marketing-NBC/NBC-3D-ledkolom-Preview/releases/tag/anders', status: 'klaar', previews: [KLAAR] },
    { id: 'lk-2', bron: RELEASE, status: 'klaar', previews: [KLAAR] },
  ])
  assertEquals(await res.json(), { verwerkt: 0, verouderd: 2 })
  assertEquals(s.comments, [])
})

Deno.test('twee links van één aanvraag: één keer nazorg', async () => {
  const s = setup({
    previews: [rij(), rij({ id: 'lk-2', bron: `${RELEASE}-b` })],
    wachtend: [{ id: 'op-1', door: 'devi', status: 'wacht_op_preview' }],
  })
  await s.meld([{ id: 'lk-1', bron: RELEASE, status: 'klaar', previews: [KLAAR] }, { id: 'lk-2', bron: `${RELEASE}-b`, status: 'klaar', previews: [KLAAR] }])
  assertEquals(s.opgeleverd.length, 1)
})

Deno.test('een onleesbare melding of een vreemde map wordt geweigerd', async () => {
  const s = setup()
  assertEquals((await s.meld([{ id: 'lk-1', status: 'misschien' }])).status, 400)
  assertEquals((await s.meld([{ id: 'lk-1', bron: RELEASE, status: 'klaar', previews: [{ naam: 'x', slug: '../../kwaad' }] }])).status, 400)
  assertEquals((await s.vraag({ method: 'DELETE' })).status, 405)
})
