import { createClient } from '@supabase/supabase-js'
import { env, requireEnv } from './config.mjs'

let client = null

export function supabase() {
  if (!client) {
    const url = requireEnv('SUPABASE_URL')
    const key = env('SUPABASE_SECRET_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY')
    if (!key) throw new Error('SUPABASE_SECRET_KEY (of SUPABASE_SERVICE_ROLE_KEY) ontbreekt')
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  }
  return client
}

export async function getAanvraag(id) {
  const { data, error } = await supabase().from('aanvragen').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Supabase select: ${error.message}`)
  if (!data) throw new Error(`Aanvraag ${id} niet gevonden`)
  return data
}

export async function updateAanvraag(id, patch) {
  const { error } = await supabase()
    .from('aanvragen')
    .update({ ...patch, brand_updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Supabase update: ${error.message}`)
}

export async function uploadAsset(id, name, buffer, contentType) {
  const path = `${id}/${name}`
  const { error } = await supabase().storage.from('brand-assets').upload(path, buffer, { contentType, upsert: true })
  if (error) throw new Error(`Storage upload ${path}: ${error.message}`)
  return path
}
