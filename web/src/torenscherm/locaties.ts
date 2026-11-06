import type { Locatie } from '../../../shared/request-types'
import nbcFoto from '../assets/torenscherm/nbc-torenscherm.jpg'
import type { Hoeken } from './perspectief'

/**
 * De foto van het torenscherm per locatie, met waar het scherm erop staat.
 *
 * De hoeken zijn opgemeten in pixels van de foto, op de rand van het lichtgevende deel (binnen de
 * zwarte rand van het scherm). Vervang je de foto, meet ze dan opnieuw: ze horen bij deze ene
 * opname. Een locatie die hier niet staat, krijgt geen preview: zie TORENSCHERM_LOCATIES in
 * shared/torenscherm-preview.ts, die moet hiermee kloppen.
 */
export interface TorenschermFoto {
  src: string
  breedte: number
  hoogte: number
  hoeken: Hoeken
  /** Het uitsnede bij "Dichterbij": x, y, breedte, hoogte, in dezelfde verhouding als de foto. */
  dichtbij: readonly [number, number, number, number]
  /** Waar het scherm staat, voor de tekst onder de foto. */
  plek: string
}

export const LOCATIES: Partial<Record<Locatie, TorenschermFoto>> = {
  nbc: {
    src: nbcFoto,
    breedte: 2000,
    hoogte: 1333,
    hoeken: [[186.5, 280], [789.5, 402.5], [789.5, 649.3], [186.5, 668.6]],
    dichtbij: [70, 165, 930, 620],
    plek: 'bij de ingang van NBC',
  },
}
