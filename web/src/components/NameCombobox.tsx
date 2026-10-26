import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'

interface Props {
  value: string
  onChange: (value: string) => void
  names: string[]
  invalid?: boolean
  id?: string
  /**
   * Enter terwijl de lijst openstaat maar er geen naam in is aangewezen: dan is wat er getypt staat
   * de naam, en hoort Enter door te gaan. Headless UI houdt die Enter anders zelf en sluit alleen de
   * lijst, zodat je voor een nieuwe naam twee keer moet drukken.
   */
  onEnter?: () => void
}

function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function filter(names: string[], query: string): string[] {
  const q = normalize(query.trim())
  if (!q) return names
  const starts = names.filter((n) => normalize(n).startsWith(q))
  const contains = names.filter((n) => !normalize(n).startsWith(q) && normalize(n).includes(q))
  return [...starts, ...contains]
}

export function NameCombobox({ value, onChange, names, invalid, id, onEnter }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [])

  const filtered = useMemo(() => filter(names, query), [names, query])
  // Lijkt wat er staat op niemand in de lijst, dan zeggen we dat dat goed is. Op de ingevulde
  // naam en niet op de zoekterm: die is leeg zodra de lijst dichtgaat.
  const nieuweNaam = value.trim().length > 0 && filter(names, value).length === 0

  return (
    <Combobox
      value={value || null}
      onChange={(v: string | null) => {
        if (v) onChange(v)
      }}
      onClose={() => setQuery('')}
    >
      {/* Capture-fase: dit gebeurt vóór Headless UI de toets afhandelt en tegenhoudt. Staat de lijst
          dicht, dan laat Headless de Enter wel door en pakt het formulier hem zelf op. */}
      <div
        className="combo"
        onKeyDownCapture={(e) => {
          if (e.key !== 'Enter' || !onEnter) return
          const input = e.target as HTMLElement
          if (input.getAttribute('aria-expanded') !== 'true' || input.getAttribute('aria-activedescendant')) return
          onEnter()
        }}
      >
        <ComboboxInput
          ref={inputRef}
          id={id}
          className="field combo__input"
          displayValue={(v: string | null) => v ?? ''}
          onChange={(e) => {
            setQuery(e.target.value)
            // Wat je typt is je naam, ook als die niet in de lijst staat: iedereen mag een aanvraag
            // doen. De lijst is een hulp om sneller te kiezen, geen poortwachter.
            onChange(e.target.value)
          }}
          placeholder="Typ of kies je naam"
          autoComplete="off"
          aria-invalid={invalid ? 'true' : undefined}
          spellCheck={false}
        />
        <ComboboxButton className="combo__chevron" aria-label="Toon alle namen">
          <Icon name="chevron-down" />
        </ComboboxButton>
      </div>
      {/* Geen treffers: geen lege lijst die over de knop eronder valt, maar een regel onder het veld. */}
      {filtered.length ? (
        <ComboboxOptions anchor="bottom start" className="combo__list" modal={false}>
          {filtered.map((n) => (
            <ComboboxOption key={n} value={n} className="combo__opt">
              <span>{n}</span>
              <Icon name="check" />
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      ) : null}
      {nieuweNaam ? <p className="hint combo__nieuw">Niet in de lijst? Geen probleem: typ je volledige naam en ga door.</p> : null}
    </Combobox>
  )
}
