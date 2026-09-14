import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'

interface Props {
  value: string
  onChange: (value: string) => void
  names: string[]
  invalid?: boolean
  id?: string
}

function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function NameCombobox({ value, onChange, names, invalid, id }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [])

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return names
    const starts = names.filter((n) => normalize(n).startsWith(q))
    const contains = names.filter((n) => !normalize(n).startsWith(q) && normalize(n).includes(q))
    return [...starts, ...contains]
  }, [names, query])

  return (
    <Combobox
      value={value || null}
      onChange={(v: string | null) => {
        if (v) onChange(v)
      }}
      onClose={() => setQuery('')}
    >
      <div className="combo">
        <ComboboxInput
          ref={inputRef}
          id={id}
          className="field combo__input"
          displayValue={(v: string | null) => v ?? ''}
          onChange={(e) => {
            setQuery(e.target.value)
            // Vrij typen wist de keuze; alleen een optie uit de lijst telt.
            if (value && e.target.value !== value) onChange('')
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
      <ComboboxOptions anchor="bottom start" className="combo__list" modal={false}>
        {filtered.length === 0 ? (
          <div className="combo__empty">Geen collega gevonden. Staat je naam er niet bij? Vraag Devi om je toe te voegen.</div>
        ) : (
          filtered.map((n) => (
            <ComboboxOption key={n} value={n} className="combo__opt">
              <span>{n}</span>
              <Icon name="check" />
            </ComboboxOption>
          ))
        )}
      </ComboboxOptions>
    </Combobox>
  )
}
