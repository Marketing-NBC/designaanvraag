import { addMonths, endOfMonth, format, getDay, startOfMonth } from 'date-fns'
import { nl } from 'date-fns/locale'
import { useMemo, useRef, useState } from 'react'
import { formatLong, fromIso, todayIso, toIso } from '../lib/dates'
import { Icon } from './Icon'

interface Props {
  value: string | null
  onChange: (iso: string) => void
  /** Vroegste toegestane datum (ISO). Standaard vandaag. */
  min?: string
  /** Laatste toegestane datum (ISO). */
  max?: string
  /** Wordt aangeroepen na een keuze, zodat de focus naar de knop kan. */
  onPicked?: () => void
}

const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

export function DateField({ value, onChange, min, max, onPicked }: Props) {
  const today = todayIso()
  const minIso = min ?? today
  const [month, setMonth] = useState<Date>(() => startOfMonth(value ? fromIso(value) : new Date()))
  const gridRef = useRef<HTMLDivElement>(null)

  const days = useMemo(() => {
    const first = startOfMonth(month)
    const last = endOfMonth(month)
    // Maandag = 0
    const lead = (getDay(first) + 6) % 7
    const cells: (Date | null)[] = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [month])

  const monthIso = toIso(month)
  const canPrev = toIso(endOfMonth(addMonths(month, -1))) >= minIso
  const canNext = !max || toIso(startOfMonth(addMonths(month, 1))) <= max

  function isDisabled(d: Date) {
    const iso = toIso(d)
    return iso < minIso || (max ? iso > max : false)
  }

  function pick(d: Date) {
    onChange(toIso(d))
    onPicked?.()
  }

  // Pijltjestoetsen binnen het raster (roving focus).
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (!target.matches('.date__day')) return
    const buttons = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('.date__day:not(.date__day--empty)') ?? [])
    const i = buttons.indexOf(target as HTMLButtonElement)
    if (i < 0) return
    const delta: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }
    const d = delta[e.key]
    if (d === undefined) return
    e.preventDefault()
    e.stopPropagation()
    const next = buttons[i + d]
    if (next) next.focus()
    else if (d > 0 && canNext) setMonth(addMonths(month, 1))
    else if (d < 0 && canPrev) setMonth(addMonths(month, -1))
  }

  // Bepaal welke dag tabbable is: geselecteerde dag, anders eerste beschikbare.
  const focusIso = value && value.startsWith(monthIso.slice(0, 7)) ? value : (days.find((d) => d && !isDisabled(d)) ? toIso(days.find((d) => d && !isDisabled(d))!) : null)

  return (
    <div className="date">
      <div className="date__head">
        <div className="date__month" aria-live="polite">
          {format(month, 'LLLL yyyy', { locale: nl })}
        </div>
        <div className="date__nav">
          <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} disabled={!canPrev} aria-label="Vorige maand">
            <Icon name="arrow-left" />
          </button>
          <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} disabled={!canNext} aria-label="Volgende maand">
            <Icon name="arrow-right" />
          </button>
        </div>
      </div>
      <div className="date__grid" role="grid" ref={gridRef} onKeyDown={onKeyDown}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="date__wd" role="columnheader" aria-label={w}>
            {w}
          </div>
        ))}
        {days.map((d, i) =>
          d ? (
            <button
              key={toIso(d)}
              type="button"
              role="gridcell"
              className={`date__day${toIso(d) === today ? ' date__day--today' : ''}`}
              aria-pressed={value === toIso(d)}
              aria-label={format(d, 'EEEE d MMMM yyyy', { locale: nl })}
              disabled={isDisabled(d)}
              tabIndex={focusIso === toIso(d) ? 0 : -1}
              onClick={() => pick(d)}
            >
              {d.getDate()}
            </button>
          ) : (
            <span key={`e${i}`} className="date__day date__day--empty" aria-hidden="true" />
          ),
        )}
      </div>
      <div className="date__selected">
        {value ? (
          <>
            Gekozen: <strong>{formatLong(value)}</strong>
          </>
        ) : (
          'Kies een dag in de kalender.'
        )}
      </div>
    </div>
  )
}
