import { useEffect, useState } from 'react'
import type { SubmitResult } from '../../../shared/aanvraag-schema'
import { fetchStatus, type BrandStatus } from '../lib/api'
import { Icon } from './Icon'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const POLL_MS = 8_000
const POLL_MAX_MS = 10 * 60_000

export function Success({ result, website, naam, onRestart }: { result: SubmitResult; website: string; naam: string; onRestart: () => void }) {
  const first = naam.split(' ')[0]
  // Zonder website is er niets op te halen; dat is geen mislukking maar een overslag.
  const [status, setStatus] = useState<BrandStatus>(result.brand_dispatched ? 'running' : website.trim() ? 'failed' : 'overgeslagen')

  // Zolang de huisstijl wordt opgehaald: elke paar seconden de status ophalen.
  useEffect(() => {
    if (!result.brand_dispatched) return
    const startedAt = Date.now()
    let stopped = false
    let timer = 0
    const tick = async () => {
      if (stopped) return
      const s = await fetchStatus(result.aanvraag_id)
      if (stopped) return
      if (s) {
        setStatus(s.brand_status)
        if (s.brand_status === 'done' || s.brand_status === 'failed') return
      }
      if (Date.now() - startedAt < POLL_MAX_MS) timer = window.setTimeout(tick, POLL_MS)
    }
    timer = window.setTimeout(tick, POLL_MS)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [result.aanvraag_id, result.brand_dispatched])

  const host = <strong>{hostOf(website)}</strong>
  const statusText =
    status === 'overgeslagen' ? (
      <>Je gaf geen website op, dus we halen geen huisstijl op. Het marketingteam zoekt zelf uit hoe het eruit moet zien.</>
    ) : status === 'done' ? (
      <>Logo, kleuren en fonts van {host} liggen klaar bij je aanvraag.</>
    ) : status === 'failed' ? (
      <>De huisstijl van {host} kon niet automatisch worden opgehaald. Het marketingteam kijkt zelf even mee.</>
    ) : (
      <>We halen nu automatisch logo, kleuren en fonts op van {host}. Binnen ongeveer vijf minuten ligt dat klaar bij je aanvraag.</>
    )

  return (
    <section className="success">
      <div className="success__content">
        <span className="eyebrow">aanvraag verstuurd</span>
        <h1 className="success__title swash">Gelukt.</h1>
        <p className="success__lead">
          Dankjewel {first}. Je aanvraag staat klaar voor het marketingteam. Ze zien hem direct in hun lijst.
        </p>
        <div className={`success__status success__status--${status === 'overgeslagen' ? 'done' : status}`} aria-live="polite">
          {status === 'running' || status === 'pending' ? <span className="spinner spinner--dark" aria-hidden="true" /> : <Icon name={status === 'failed' ? 'alert' : 'check'} />}
          <span>{statusText}</span>
        </div>
        <div className="success__actions">
          {/* Geen link naar het werksysteem van Marketing: collega's werken daar niet in. */}
          <button type="button" className="btn btn--primary" onClick={onRestart}>
            Nieuwe aanvraag
            <Icon name="arrow-right" className="arrow" />
          </button>
        </div>
      </div>
    </section>
  )
}
