import hero from '../assets/brand/hero-event.jpg'
import logoWhite from '../assets/brand/nbc-logo-white-no-payoff.png'
import { Icon } from './Icon'

export function Start({ onStart, onAanvullen, stepCount }: { onStart: () => void; onAanvullen: () => void; stepCount: number }) {
  return (
    <section className="start">
      <img className="start__img" src={hero} alt="" fetchPriority="high" />
      <div className="start__shade" aria-hidden="true" />
      <div className="start__content">
        <img className="start__logo" src={logoWhite} alt="NBC" />
        <span className="eyebrow eyebrow--light">voor het marketingteam</span>
        <h1 className="start__title swash">Designaanvraag</h1>
        <p className="start__lead">Vertel ons wat je nodig hebt. Het marketingteam gaat ermee aan de slag, met de juiste huisstijl erbij.</p>
        <button type="button" className="btn btn--light" onClick={onStart} autoFocus data-primary-action>
          Start
          <Icon name="arrow-right" className="arrow" />
        </button>
        <p className="start__meta">
          {stepCount} vragen, ongeveer 2 minuten. <span className="hint--kbd">Enter is volgende.</span>
        </p>
        {/* Loopt er al een aanvraag, dan hoort een wijziging daarbij en niet in een nieuwe taak. */}
        <p className="start__meta">
          Al een aanvraag gedaan?{' '}
          <button type="button" className="link link--light" onClick={onAanvullen}>
            Iets aanvullen of wijzigen
          </button>
        </p>
      </div>
    </section>
  )
}
