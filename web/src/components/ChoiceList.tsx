import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { TextField } from './TextField'

export interface ChoiceOption {
  key: string
  label: string
  description?: string
}

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

interface CommonProps {
  options: readonly ChoiceOption[]
  /** Kaartweergave met titel + omschrijving (voor de custom/standaard-keuze). */
  cards?: boolean
  /** Sleutel van de "Anders"-optie die een vrij tekstveld toont. */
  otherKey?: string
  otherValue?: string
  onOtherChange?: (v: string) => void
  otherInvalid?: boolean
}

type Props =
  | (CommonProps & { multi: true; value: readonly string[]; onToggle: (key: string) => void })
  | (CommonProps & { multi?: false; value: string | null; onToggle: (key: string) => void })

export function ChoiceList(props: Props) {
  const { options, cards, otherKey, otherValue = '', onOtherChange, otherInvalid } = props
  const rootRef = useRef<HTMLDivElement>(null)

  // Focus op het blok zodat lettertoetsen en pijltjes werken zonder dat een knop "geselecteerd" oogt.
  useEffect(() => {
    const t = window.setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [])

  const isSelected = (key: string) => (props.multi ? props.value.includes(key) : props.value === key)
  const otherSelected = otherKey ? isSelected(otherKey) : false

  return (
    <div
      className={`opts${cards ? ' opts--cards' : ''}`}
      role={props.multi ? 'group' : 'radiogroup'}
      ref={rootRef}
      tabIndex={-1}
      data-choice-list
    >
      {options.map((o, i) => {
        const selected = isSelected(o.key)
        const letter = LETTERS[i]
        const a11y = props.multi ? { 'aria-pressed': selected } : { role: 'radio', 'aria-checked': selected }
        return (
          <button
            key={o.key}
            type="button"
            className={`opt${cards ? ' opt--card' : ''}`}
            onClick={() => props.onToggle(o.key)}
            data-letter={letter}
            {...a11y}
          >
            {cards ? (
              <>
                <span className="opt__row">
                  <span className="opt__key" aria-hidden="true">
                    {letter}
                  </span>
                  <span className="opt__title">{o.label}</span>
                  <Icon name="check" className="opt__check" />
                </span>
                {o.description ? <span className="opt__desc">{o.description}</span> : null}
              </>
            ) : (
              <>
                <span className="opt__key" aria-hidden="true">
                  {letter}
                </span>
                <span className="opt__label">{o.label}</span>
                <Icon name="check" className="opt__check" />
              </>
            )}
          </button>
        )
      })}
      {otherKey && otherSelected ? (
        <div className="opt__other">
          <label className="sr-only" htmlFor="anders-tekst">
            Anders, namelijk
          </label>
          <TextField
            id="anders-tekst"
            className="field--sm"
            value={otherValue}
            onChange={(v) => onOtherChange?.(v)}
            placeholder="Wat wil je aanvragen?"
            invalid={otherInvalid}
            maxLength={200}
            data-other-input
          />
        </div>
      ) : null}
    </div>
  )
}
