import { useRef, useState } from 'react'
import { ACCEPT_ATTRIBUUT, MAX_BIJLAGEN, MAX_BIJLAGE_BYTES, formatBytes } from '../../../shared/bijlagen'
import type { Bijlage } from '../lib/uploads'
import { Icon } from './Icon'

/**
 * Bestanden kiezen of erin slepen. De sleepzone is een echte knop: dan werkt hij met het toetsenbord
 * en met een schermlezer, en doet de Enter-afhandeling in App.tsx vanzelf het juiste (knoppen zonder
 * `data-primary-action` handelen hun eigen toets af).
 *
 * Fouten per bestand staan in de regel zelf, niet in de foutsleuf van de vraag: die is voor wat
 * doorgaan blokkeert, en één afgekeurd bestand hoort de rest niet tegen te houden.
 */

interface Props {
  bijlagen: Bijlage[]
  onKies: (files: FileList | File[]) => void
  onVerwijder: (lokaalId: string) => void
}

export function FileField({ bijlagen, onKies, onVerwijder }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [sleept, setSleept] = useState(false)

  const meetellend = bijlagen.filter((b) => b.status !== 'fout')
  const vol = meetellend.length >= MAX_BIJLAGEN

  return (
    <div className="bijlagen">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUUT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) onKies(e.target.files)
          // Leegmaken, anders kun je hetzelfde bestand niet nog eens kiezen na het weghalen.
          e.target.value = ''
        }}
      />

      <button
        type="button"
        className={`bijlagen__zone${sleept ? ' bijlagen__zone--actief' : ''}`}
        onClick={() => input.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault()
          setSleept(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          // Alleen loslaten als de muis het hele blok verlaat, niet bij elk kind eronder.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSleept(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setSleept(false)
          if (e.dataTransfer.files?.length) onKies(e.dataTransfer.files)
        }}
      >
        <Icon name="paperclip" className="bijlagen__clip" />
        <span className="bijlagen__zone-tekst">
          <span className="bijlagen__zone-titel">{vol ? 'Je hebt het maximum bereikt' : 'Sleep bestanden hierheen of klik om te kiezen'}</span>
          <span className="bijlagen__zone-meta">
            Maximaal {MAX_BIJLAGEN} bestanden, {formatBytes(MAX_BIJLAGE_BYTES)} per stuk
          </span>
        </span>
      </button>

      {bijlagen.length ? (
        <ul className="bijlagen__lijst">
          {bijlagen.map((b) => (
            <li key={b.lokaalId} className={`bijlage bijlage--${b.status}`}>
              <span className="bijlage__tekst">
                <span className="bijlage__naam">{b.bestandsnaam}</span>
                <span className="bijlage__meta">
                  {b.status === 'klaar' ? (
                    <>
                      <Icon name="check" size={16} /> klaar · {formatBytes(b.bytes)}
                    </>
                  ) : b.status === 'fout' ? (
                    b.fout
                  ) : (
                    `${Math.round(b.voortgang * 100)}% van ${formatBytes(b.bytes)}`
                  )}
                </span>
                {b.status === 'bezig' || b.status === 'wacht' ? (
                  <span className="bijlage__balk" aria-hidden="true">
                    <span className="bijlage__balk-vulling" style={{ transform: `scaleX(${b.voortgang})` }} />
                  </span>
                ) : null}
              </span>
              <button type="button" className="bijlage__wis" onClick={() => onVerwijder(b.lokaalId)} aria-label={`${b.bestandsnaam} weghalen`}>
                <Icon name="close" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
