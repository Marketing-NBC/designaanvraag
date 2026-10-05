import type { SubmitResult } from '../../../shared/aanvraag-schema'
import { Icon } from './Icon'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Het scherm na het versturen.
 *
 * De huisstijl wordt op de achtergrond opgehaald en dat duurt een paar minuten. Hier
 * stond daarom een draaiend bolletje dat de status bijhield - maar daarmee leek het
 * alsof de collega moest blijven wachten op iets waar hij niets mee doet. Hij kan het
 * venster gewoon sluiten; het marketingteam ziet het resultaat vanzelf. Dus: geen
 * spinner, geen statusverversing, en een regel die zegt dat hij klaar is.
 */
export function Success({ result, website, naam, onRestart }: { result: SubmitResult; website: string; naam: string; onRestart: () => void }) {
  const first = naam.split(' ')[0]
  const host = <strong>{hostOf(website)}</strong>
  // Zonder website is er niets op te halen; dat is geen mislukking maar een overslag.
  const soort = result.brand_dispatched ? 'loopt' : website.trim() ? 'failed' : 'overgeslagen'

  const statusText =
    soort === 'overgeslagen' ? (
      <>Je gaf geen website op, dus we halen geen huisstijl op. Het marketingteam zoekt zelf uit hoe het eruit moet zien.</>
    ) : soort === 'failed' ? (
      <>De huisstijl van {host} kon niet automatisch worden opgehaald. Het marketingteam kijkt zelf even mee.</>
    ) : (
      <>Logo, kleuren en fonts van {host} halen we op de achtergrond op. Daar hoef je niet op te wachten — je kunt dit venster sluiten.</>
    )

  return (
    <section className="success">
      <div className="success__content">
        <span className="eyebrow">aanvraag verstuurd</span>
        <h1 className="success__title swash">Gelukt.</h1>
        <p className="success__lead">
          Dankjewel {first}. Je aanvraag staat klaar voor het marketingteam. Ze zien hem direct in hun lijst.
        </p>
        <div className={`success__status success__status--${soort === 'failed' ? 'failed' : 'done'}`}>
          <Icon name={soort === 'failed' ? 'alert' : 'check'} />
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
