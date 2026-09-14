import { useEffect, useRef, type InputHTMLAttributes } from 'react'

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  /** Focus bij mount, na de stap-animatie. */
  focusOnMount?: boolean
}

export function TextField({ value, onChange, invalid, focusOnMount = true, className = '', ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focusOnMount) return
    const t = window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [focusOnMount])

  return (
    <input
      ref={ref}
      className={`field ${className}`.trim()}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid ? 'true' : undefined}
      autoComplete="off"
      spellCheck={false}
      {...rest}
    />
  )
}

export function TextArea({
  value,
  onChange,
  invalid,
  maxLength,
  focusOnMount = true,
  placeholder,
  id,
}: {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  maxLength?: number
  focusOnMount?: boolean
  placeholder?: string
  id?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!focusOnMount) return
    const t = window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(t)
  }, [focusOnMount])

  // Groeit mee met de inhoud.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(150, el.scrollHeight)}px`
  }, [value])

  return (
    <>
      <textarea
        ref={ref}
        id={id}
        className="field field--textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? 'true' : undefined}
        maxLength={maxLength}
        placeholder={placeholder}
        rows={4}
      />
      {maxLength ? (
        <div className="counter" aria-hidden="true">
          {value.length} / {maxLength}
        </div>
      ) : null}
    </>
  )
}
