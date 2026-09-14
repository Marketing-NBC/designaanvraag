import { asanaFields, createAsanaTaskClient } from '../_shared/asana.ts'
import { createWebhookStore } from '../_shared/db.ts'
import { readEnv, webhookToken } from '../_shared/env.ts'
import { createHandler } from './handler.ts'

const env = readEnv()
if (!env.asanaPat) throw new Error('ASANA_PAT is verplicht voor asana-webhook')

const handler = createHandler({
  token: await webhookToken(env.asanaPat),
  store: createWebhookStore(env.supabaseUrl, env.supabaseSecretKey),
  asana: createAsanaTaskClient(env.asanaPat),
  cfg: asanaFields,
  planningProjectGid: env.asanaPlanningProjectGid,
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('asana-webhook: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis' }), { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  }
})
