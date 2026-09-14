import type { SubmitResult } from '../../../shared/aanvraag-schema'
import { Icon } from './Icon'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function Success({ result, website, naam, onRestart }: { result: SubmitResult; website: string; naam: string; onRestart: () => void }) {
  const first = naam.split(' ')[0]
  return (
    <section className="success">
      <div className="success__content">
        <span className="eyebrow">aanvraag verstuurd</span>
        <h1 className="success__title swash">Gelukt.</h1>
        <p className="success__lead">
          Dankjewel {first}. Je aanvraag staat {result.asana_task_url ? 'in Asana' : 'klaar'} voor Abel. Hij ziet hem direct in zijn lijst.
        </p>
        <div className="success__status">
          <Icon name="sparkle" />
          <span>
            {result.brand_dispatched ? (
              <>
                We halen nu automatisch logo, kleuren en fonts op van <strong>{hostOf(website)}</strong>. Binnen ongeveer vijf minuten staat dat bij de aanvraag in Asana.
              </>
            ) : (
              <>
                De huisstijl van <strong>{hostOf(website)}</strong> wordt nog niet automatisch opgehaald. Abel kijkt zelf even mee.
              </>
            )}
          </span>
        </div>
        <div className="success__actions">
          {result.asana_task_url ? (
            <a className="btn btn--primary" href={result.asana_task_url} target="_blank" rel="noreferrer">
              Bekijk in Asana
              <Icon name="external" className="arrow" />
            </a>
          ) : null}
          <button type="button" className={result.asana_task_url ? 'link' : 'btn btn--primary'} onClick={onRestart}>
            Nieuwe aanvraag
            {!result.asana_task_url ? <Icon name="arrow-right" className="arrow" /> : null}
          </button>
        </div>
      </div>
    </section>
  )
}
