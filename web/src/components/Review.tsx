import { useEffect, useRef } from 'react'
import { reviewRows } from '../lib/review'
import type { Draft } from '../state'
import { Icon } from './Icon'

export function Review({
  draft,
  onEdit,
  onSubmit,
  busy,
  error,
  titleId,
}: {
  draft: Draft
  onEdit: (stepId: string) => void
  onSubmit: () => void
  busy: boolean
  error: string | null
  titleId: string
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  // Focus zonder te scrollen, zodat het overzicht bovenaan begint.
  useEffect(() => {
    const t = window.setTimeout(() => btnRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <section className="q" role="group" aria-labelledby={titleId}>
      <div className="q__num" aria-hidden="true">
        <Icon name="check" />
      </div>
      <header className="q__head">
        <h1 className="q__title" id={titleId}>
          Klopt dit?
        </h1>
        <p className="q__help">Check je aanvraag. Aanpassen kan per regel.</p>
      </header>
      <div className="q__body">
        <div className="review__list">
          {reviewRows(draft).map((r) => (
            <div className="review__row" key={r.label}>
              <div>
                <div className="review__label">{r.label}</div>
                <div className={`review__value${r.muted ? ' review__value--muted' : ''}`}>{r.value}</div>
              </div>
              <button type="button" className="link review__edit" onClick={() => onEdit(r.stepId)}>
                wijzig
              </button>
            </div>
          ))}
        </div>
        {error ? (
          <p className="msg msg--error" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
      <footer className="q__footer">
        <button ref={btnRef} type="button" className="btn btn--primary" onClick={onSubmit} disabled={busy} data-primary-action>
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {busy ? 'Versturen…' : 'Verstuur aanvraag'}
          {!busy ? <Icon name="arrow-right" className="arrow" /> : null}
        </button>
        {!busy ? (
          <span className="hint hint--kbd">
            druk op <kbd>Enter</kbd>
          </span>
        ) : null}
      </footer>
    </section>
  )
}
