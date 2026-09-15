import { createClient } from '@supabase/supabase-js'
import { readEnv } from '../_shared/env.ts'
import { createStatusHandler, type StatusRow } from './handler.ts'

const env = readEnv()
const sb = createClient(env.supabaseUrl, env.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } })

const handler = createStatusHandler({
  env,
  async find(id) {
    const { data, error } = await sb.from('aanvragen').select('id, brand_status, asana_task_url, brand_error').eq('id', id).maybeSingle()
    if (error) throw new Error(`db select: ${error.message}`)
    return (data as StatusRow | null) ?? null
  },
})

Deno.serve(async (req) => {
  try {
    return await handler(req)
  } catch (e) {
    console.error('aanvraag-status: onverwachte fout', e)
    return new Response(JSON.stringify({ error: 'Er ging iets mis.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': env.allowedOrigins[0] ?? '' },
    })
  }
})
