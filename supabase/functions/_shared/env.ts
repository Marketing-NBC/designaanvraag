/** Omgevingsvariabelen van de edge functions, met veilige defaults. */
export interface Env {
  supabaseUrl: string
  supabaseSecretKey: string
  allowedOrigins: string[]
  rateSalt: string
  rateLimitIpPerHour: number
  rateLimitGlobalPerDay: number
  asanaPat: string | null
  asanaProjectGid: string | null
  asanaAssigneeGid: string | null
  /** Project waar ingeplande taken ook in komen; standaard uit asana-fields.json. */
  asanaPlanningProjectGid: string | null
  routineFireUrl: string | null
  routineToken: string | null
}

const DEFAULT_ORIGINS = ['https://marketing-nbc.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173']

function opt(name: string): string | null {
  const v = Deno.env.get(name)?.trim()
  return v ? v : null
}

function num(name: string, fallback: number): number {
  const v = Number(Deno.env.get(name))
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export function readEnv(): Env {
  const supabaseUrl = opt('SUPABASE_URL')
  // SB_SECRET_KEY zetten wij zelf via de deploy; de andere twee injecteert Supabase. Die eerste gaat
  // voor, want een nieuw project levert niet altijd een bruikbare sleutel mee: met de nieuwe
  // sleutelsoort staan de oude JWT-sleutels standaard uit, en dan faalt elke query met 401.
  // (Secrets mogen bij Supabase niet met SUPABASE_ beginnen, vandaar de naam SB_SECRET_KEY.)
  const supabaseSecretKey = opt('SB_SECRET_KEY') ?? opt('SUPABASE_SECRET_KEY') ?? opt('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !supabaseSecretKey) throw new Error('SUPABASE_URL en SB_SECRET_KEY (of SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY) zijn verplicht')
  return {
    supabaseUrl,
    supabaseSecretKey,
    allowedOrigins: (opt('ALLOWED_ORIGINS')?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_ORIGINS),
    rateSalt: opt('RATE_SALT') ?? 'nbc-designaanvraag',
    rateLimitIpPerHour: num('RATE_LIMIT_IP_PER_HOUR', 10),
    rateLimitGlobalPerDay: num('RATE_LIMIT_GLOBAL_PER_DAY', 100),
    asanaPat: opt('ASANA_PAT'),
    asanaProjectGid: opt('ASANA_PROJECT_GID'),
    asanaAssigneeGid: opt('ASANA_ASSIGNEE_GID'),
    asanaPlanningProjectGid: opt('ASANA_PLANNING_PROJECT_GID'),
    routineFireUrl: opt('ROUTINE_FIRE_URL'),
    routineToken: opt('ROUTINE_TOKEN'),
  }
}

/**
 * Token in de URL van de Asana-webhook, afgeleid van ASANA_PAT zodat scripts/asana-webhook.mjs
 * dezelfde waarde kan berekenen zonder extra secret. Niet omkeerbaar naar de PAT.
 */
export async function webhookToken(pat: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`asana-webhook:${pat}`))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
