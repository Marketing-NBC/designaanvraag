/**
 * Start de Claude Code Routine "Huisstijl ophalen" via de API-trigger.
 * Docs: https://code.claude.com/docs/en/routines#add-an-api-trigger
 */
export interface RoutineClient {
  fire(text: string): Promise<{ sessionUrl: string | null }>
}

export function createRoutineClient(fireUrl: string, token: string): RoutineClient {
  return {
    async fire(text) {
      const res = await fetch(fireUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'experimental-cc-routine-2026-04-01',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await res.json().catch(() => ({}))) as { claude_code_session_url?: string; error?: { message?: string } }
      if (!res.ok) throw new Error(`Routine starten mislukt (${res.status}: ${body.error?.message ?? 'onbekende fout'})`)
      return { sessionUrl: body.claude_code_session_url ?? null }
    },
  }
}
