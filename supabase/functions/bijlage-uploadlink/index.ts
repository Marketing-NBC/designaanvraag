import { createDb } from '../_shared/db.ts'
import { readEnv } from '../_shared/env.ts'
import { createStorage } from '../_shared/storage.ts'
import { createHandler } from './handler.ts'

const env = readEnv()
const db = createDb(env.supabaseUrl, env.supabaseSecretKey)

const handler = createHandler({
  env,
  storage: createStorage(env.supabaseUrl, env.supabaseSecretKey),
  insertBijlagen: (rows) => db.insertBijlagen(rows),
  bumpRateLimit: (key, window) => db.bumpRateLimit(key, window),
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('bijlage-uploadlink: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': env.allowedOrigins[0] ?? '' },
    })
  }
})
