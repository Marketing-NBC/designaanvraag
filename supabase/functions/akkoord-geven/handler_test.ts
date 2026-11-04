import { assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import type { AsanaFieldsConfig } from '../_shared/asana.ts'
import type { AanvraagDetail, OpleveringRow } from '../_shared/db.ts'
import type { Env } from '../_shared/env.ts'
import type { MailBericht } from '../_shared/shared/mail.ts'
import { createHandler, type Deps } from './handler.ts'

const env = {
  supabaseUrl: 'http://sb', supabaseSecretKey: 'k', allowedOrigins: ['https://marketing-nbc.github.io'],
  rateSalt: 'zout', rateLimitIpPerHour: 30, rateLimitGlobalPerDay: 500,
} as unknown as Env

const cfg: AsanaFieldsConfig = { project: { gid: 'proj1' }, assignee: null, fields: {}, sections: { klaar: { gid: 'sec-klaar' }, afgerond: { gid: 'sec-afgerond' } } }
const ID = '11111111-2222-4333-8444-555555555555'

const aanvraag = {
  id: ID, naam: 'Britt', locatie: 'nbc', soort: 'evenement', event: 'EY', event_datum: '2026-12-11', deadline: '2026-12-09',
  aanvraag_types: ['torenscherm'], anders_tekst: '', omschrijving: '', gekoppelden: [], asana_task_gid: 't1',
  asana_task_url: 'https://app.asana.com/0/1/t1', vervallen_op: null,
} as unknown as AanvraagDetail

function oplevering(over: Partial<OpleveringRow> = {}): OpleveringRow {
  return {
    id: 'op-2', created_at: '2026-11-03T10:00:00Z', aanvraag_id: ID, subtaak_gid: 'sub-2', versie: 2, ontvangers: [], bijlagen: [],
    status: 'verstuurd', fout: null, verstuurd_op: '2026-11-03T10:00:00Z', door: null, herinneren: true, akkoord_op: null, akkoord_door: null,
    feedback_op: null, gestopt_op: null, gestopt_reden: null, herinneringen: 1, laatste_herinnering: null, ...over,
  }
}

function setup(opts: { aanvraag?: AanvraagDetail | null; oplevering?: OpleveringRow | null; asanaFout?: boolean; zonderAfgerond?: boolean } = {}) {
  let rij = opts.oplevering === undefined ? oplevering() : opts.oplevering
  const comments: string[] = []
  const afgerond: string[] = []
  const gemaild: MailBericht[] = []
  const deps: Deps = {
    env,
    fields: opts.zonderAfgerond ? { ...cfg, sections: { klaar: { gid: 'sec-klaar' } } } : cfg,
    now: () => new Date('2026-11-04T09:30:00Z'),
    log: () => {},
    db: {
      findById: (id) => Promise.resolve(opts.aanvraag === undefined ? (id === ID ? aanvraag : null) : opts.aanvraag),
      laatsteVerstuurd: () => Promise.resolve(rij),
      zetAkkoord: (id, door, moment) => {
        if (!rij || rij.id !== id || rij.akkoord_op) return Promise.resolve(false)
        rij = { ...rij, akkoord_op: moment.toISOString(), akkoord_door: door }
        return Promise.resolve(true)
      },
      bumpRateLimit: () => Promise.resolve(1),
      collega: (naam) => Promise.resolve(naam.trim().toLowerCase() === 'jan nieuwkomer' ? null : naam.trim().replace(/^./, (c) => c.toUpperCase())),
    },
    asana: {
      addComment: (_gid, html) => opts.asanaFout ? Promise.reject(new Error('Asana 500')) : (comments.push(html), Promise.resolve()),
      rondAf: (gid, sectie) => (afgerond.push(`${gid}:${sectie}`), Promise.resolve()),
    },
    mail: { verstuur: (b) => (gemaild.push(b), Promise.resolve()) },
  }
  return { handler: createHandler(deps), comments, afgerond, gemaild, rij: () => rij }
}

const get = (id = ID) => new Request(`https://fn/akkoord-geven?id=${id}`, { headers: { Origin: 'https://marketing-nbc.github.io' } })
const post = (body: unknown) => new Request('https://fn/akkoord-geven', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://marketing-nbc.github.io', 'x-forwarded-for': '10.0.0.1' },
  body: JSON.stringify(body),
})

Deno.test('GET laat zien wat er klaarstaat', async () => {
  const { handler } = setup()
  const res = await handler(get())
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.status, 'open')
  assertEquals(body.versie, 2)
  assertEquals(body.event, 'EY')
})

Deno.test('GET: nog niets opgeleverd, of al akkoord', async () => {
  assertEquals((await (await setup({ oplevering: null }).handler(get())).json()).status, 'geen_oplevering')
  const al = await (await setup({ oplevering: oplevering({ akkoord_op: '2026-11-03T12:00:00Z', akkoord_door: 'Karen' }) }).handler(get())).json()
  assertEquals(al.status, 'akkoord')
  assertEquals(al.akkoord_door, 'Karen')
})

Deno.test('GET: onbekend of vervallen → 404, ongeldig id → 400', async () => {
  assertEquals((await setup({ aanvraag: null }).handler(get())).status, 404)
  assertEquals((await setup({ aanvraag: { ...aanvraag, vervallen_op: '2026-11-01T00:00:00Z' } }).handler(get())).status, 404)
  assertEquals((await setup().handler(get('geen-id'))).status, 400)
})

Deno.test('POST: akkoord vastgelegd, taak naar Afgerond, reactie en mail aan Marketing', async () => {
  const s = setup()
  const res = await s.handler(post({ aanvraag_id: ID, naam: 'Britt' }))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { versie: 2, door: 'Britt', al: false })
  assertEquals(s.rij()?.akkoord_door, 'Britt')
  assertEquals(s.afgerond, ['t1:sec-afgerond'])
  assertStringIncludes(s.comments[0], 'Akkoord</strong> van Britt op versie 2')
  assertEquals(s.gemaild[0].aan, ['marketing@nbcevents.nl'])
  assertMatch(s.gemaild[0].onderwerp, /^Akkoord: EY/)
})

Deno.test('POST: een tweede akkoord doet niets en zegt wie het al gaf', async () => {
  const s = setup({ oplevering: oplevering({ akkoord_op: '2026-11-03T12:00:00Z', akkoord_door: 'Karen' }) })
  const res = await s.handler(post({ aanvraag_id: ID, naam: 'Britt' }))
  assertEquals(await res.json(), { versie: 2, door: 'Karen', al: true })
  assertEquals(s.comments, [])
  assertEquals(s.gemaild, [])
})

Deno.test('POST: nog niets opgeleverd → 409', async () => {
  const res = await setup({ oplevering: null }).handler(post({ aanvraag_id: ID, naam: 'Britt' }))
  assertEquals(res.status, 409)
})

Deno.test('POST: zonder naam → 400', async () => {
  const res = await setup().handler(post({ aanvraag_id: ID, naam: ' ' }))
  assertEquals(res.status, 400)
})

Deno.test('POST: lukt Asana niet, dan staat het akkoord toch en hoort Marketing het', async () => {
  const s = setup({ asanaFout: true })
  const res = await s.handler(post({ aanvraag_id: ID, naam: 'Britt' }))
  assertEquals(res.status, 200)
  assertEquals(s.rij()?.akkoord_door, 'Britt')
  assertStringIncludes(s.gemaild[0].html, 'Niet bijgewerkt in Asana')
})

Deno.test('POST: zonder kolom Afgerond gaat de taak naar Klaar, en zegt de mail dat', async () => {
  const s = setup({ zonderAfgerond: true })
  await s.handler(post({ aanvraag_id: ID, naam: 'Britt' }))
  assertEquals(s.afgerond, ['t1:sec-klaar'])
  assertStringIncludes(s.gemaild[0].html, 'Afgerond bestaat nog niet')
})

Deno.test('POST: wie niet in de lijst staat, kan geen akkoord geven', async () => {
  const s = setup()
  const res = await s.handler(post({ aanvraag_id: ID, naam: 'Jan Nieuwkomer' }))
  assertEquals(res.status, 400)
  assertStringIncludes((await res.json()).error, 'staat niet in de lijst')
  assertEquals(s.rij()?.akkoord_op, null)
})

Deno.test('POST: de naam komt zoals hij in de lijst staat', async () => {
  const s = setup()
  await s.handler(post({ aanvraag_id: ID, naam: 'britt' }))
  assertEquals(s.rij()?.akkoord_door, 'Britt')
})
