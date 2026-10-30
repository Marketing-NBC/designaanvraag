import { LEDKOLOM_PREVIEW_REPO, LEDKOLOM_PREVIEW_WORKFLOW } from './shared/ledkolom-preview.ts'

/** Start het bouwen van de 3D-previews in de repository NBC-3D-ledkolom-Preview. */
export interface PreviewBouwer {
  start(): Promise<void>
}

/**
 * Via "Run workflow" (workflow_dispatch) op de workflow die de previews bouwt en publiceert. Die haalt
 * zelf bij de function ledkolom-preview op wat er te bouwen valt, dus er gaat niets mee: een run die
 * GitHub weggooit omdat er een nieuwere achter staat, is daardoor geen verloren werk.
 *
 * Het token is een fine-grained token met alleen "Actions: Read and write" op die ene repository.
 */
export function createPreviewBouwer(token: string, repo = LEDKOLOM_PREVIEW_REPO, workflow = LEDKOLOM_PREVIEW_WORKFLOW): PreviewBouwer {
  return {
    async start() {
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) {
        const tekst = (await res.text().catch(() => '')).slice(0, 200)
        throw new Error(`GitHub weigerde het starten van de 3D-preview (${res.status}${tekst ? `: ${tekst}` : ''})`)
      }
    },
  }
}
