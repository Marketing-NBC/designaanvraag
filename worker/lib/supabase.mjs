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
  return uploadNaarBucket('brand-assets', id, name, buffer, contentType)
}

/** Menuschermen hebben hun eigen bucket; zie de migratie 20260922140000_menuschermen.sql. */
export async function uploadMenuscherm(id, name, buffer, contentType) {
  return uploadNaarBucket('menuschermen', id, name, buffer, contentType)
}

async function uploadNaarBucket(bucket, id, name, buffer, contentType) {
  const path = `${id}/${name}`
  const { error } = await supabase().storage.from(bucket).upload(path, buffer, { contentType, upsert: true })
  if (error) throw new Error(`Storage upload ${bucket}/${path}: ${error.message}`)
  return path
}

/**
 * Werkt de menu-velden bij. Apart van updateAanvraag omdat die brand_updated_at
 * zet; het menuscherm heeft zijn eigen tijdstempel.
 */
export async function updateMenu(id, patch) {
  const { error } = await supabase()
    .from('aanvragen')
    .update({ ...patch, menu_updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Supabase update menu: ${error.message}`)
}
