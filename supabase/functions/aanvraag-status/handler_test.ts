import { assertEquals } from 'jsr:@std/assert@1'
import type { Env } from '../_shared/env.ts'
import { createStatusHandler } from './handler.ts'

const env: Env = {
  supabaseUrl: 'http://sb',
  supabaseSecretKey: 'x',
  allowedOrigins: ['https://marketing-nbc.github.io'],
  rateSalt: 's',
  rateLimitIpPerHour: 10,
  rateLimitGlobalPerDay: 100,
  asanaPat: null,
  asanaProjectGid: null,
  asanaAssigneeGid: null,
  asanaPlanningProjectGid: null,
  routineFireUrl: null,
  routineToken: null,
}
const ID = '4f1a2b3c-4d5e-4f60-8a71-829394a5b6c7'
const handler = createStatusHandler({
  env,
  async find(id) {
    return id === ID ? { id, brand_status: 'done', asana_task_url: 'https://app.asana.com/0/1/2' } : null
  },
})

Deno.test('status van bekende aanvraag', async () => {
  const res = await handler(new Request(`http://f/aanvraag-status?id=${ID}`, { headers: { origin: 'https://marketing-nbc.github.io' } }))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { aanvraag_id: ID, brand_status: 'done', asana_task_url: 'https://app.asana.com/0/1/2' })
  assertEquals(res.headers.get('access-control-allow-origin'), 'https://marketing-nbc.github.io')
})

Deno.test('ongeldig id → 400, onbekend → 404, POST → 405', async () => {
  assertEquals((await handler(new Request('http://f/aanvraag-status?id=abc'))).status, 400)
  assertEquals((await handler(new Request('http://f/aanvraag-status?id=4f1a2b3c-4d5e-4f60-8a71-000000000000'))).status, 404)
  assertEquals((await handler(new Request(`http://f/aanvraag-status?id=${ID}`, { method: 'POST' }))).status, 405)
})
