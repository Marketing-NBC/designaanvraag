import { createAsanaTaskClient } from '../_shared/asana.ts'
import { createDb } from '../_shared/db.ts'
import { readEnv } from '../_shared/env.ts'
import { createHandler } from './handler.ts'

const env = readEnv()

const handler = createHandler({
  env,
  db: createDb(env.supabaseUrl, env.supabaseSecretKey),
  // Zonder PAT blijft de aanvulling bewaard, maar komt hij niet in Asana. Dat staat dan in
  // `asana_error`, net als bij een aanvraag zonder Asana-configuratie.
  asana: env.asanaPat ? createAsanaTaskClient(env.asanaPat) : null,
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('aanvulling-toevoegen: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': env.allowedOrigins[0] ?? '' },
    })
  }
})
