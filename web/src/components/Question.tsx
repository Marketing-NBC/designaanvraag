import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  number: number
  title: string
  help?: string
  error?: string | null
  warning?: string | null
  /** Verandert bij elke nieuwe fout, zodat het veld opnieuw "schudt". */
  errorNonce?: number
  children: ReactNode
  footer: ReactNode
  titleId: string
}

export function Question({ number, title, help, error, warning, errorNonce = 0, children, footer, titleId }: Props) {
  return (
    <section className="q" role="group" aria-labelledby={titleId}>
      <div className="q__num" aria-hidden="true">
        {String(number).padStart(2, '0')}
        <Icon name="arrow-right" />
      </div>
      <header className="q__head">
        <h1 className="q__title" id={titleId}>
          {title}
        </h1>
        {help ? <p className="q__help">{help}</p> : null}
      </header>
      <motion.div
        className="q__body"
        key={errorNonce}
        initial={false}
        animate={errorNonce ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.35 }}
      >
        {children}
        {error ? (
          <p className="msg msg--error" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </p>
        ) : null}
        {!error && warning ? (
          <p className="msg msg--warn">
            <Icon name="alert" />
            <span>{warning}</span>
          </p>
        ) : null}
      </motion.div>
      <footer className="q__footer">{footer}</footer>
    </section>
  )
}

export function PrimaryAction({
  label = 'Volgende',
  onClick,
  hint = 'Enter',
  busy = false,
}: {
  label?: string
  onClick: () => void
  hint?: string | null
  busy?: boolean
}) {
  return (
    <>
      <button type="button" className="btn btn--primary" onClick={onClick} disabled={busy} data-primary-action>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {label}
        {!busy ? <Icon name="arrow-right" className="arrow" /> : null}
      </button>
      {hint ? (
        <span className="hint hint--kbd">
          druk op <kbd>{hint}</kbd>
        </span>
      ) : null}
    </>
  )
}
