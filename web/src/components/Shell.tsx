import type { ReactNode } from 'react'
import logo from '../assets/brand/nbc-logo-color-no-payoff.png'
import { Icon } from './Icon'

interface Props {
  /** 0–1 */
  progress: number
  /** Tekst rechtsonder, bv. "03 / 09" */
  counter: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  children: ReactNode
}

export function Shell({ progress, counter, canPrev, canNext, onPrev, onNext, children }: Props) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__row">
          <img className="topbar__logo" src={logo} alt="NBC" />
          <span className="topbar__meta">designaanvraag</span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Voortgang">
          <div className="progress__bar" style={{ width: `${Math.max(2, progress * 100)}%` }} />
        </div>
      </header>
      <main className="stage">
        <div className="stage__inner">{children}</div>
      </main>
      <nav className="navdock" aria-label="Vragen">
        <span className="navdock__count" aria-hidden="true">
          {counter}
        </span>
        <button type="button" className="icon-btn" onClick={onPrev} disabled={!canPrev} aria-label="Vorige vraag">
          <Icon name="chevron-up" />
        </button>
        <button type="button" className="icon-btn" onClick={onNext} disabled={!canNext} aria-label="Volgende vraag">
          <Icon name="chevron-down" />
        </button>
      </nav>
    </div>
  )
}
