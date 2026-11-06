import { describe, expect, it } from 'vitest'
import { matrix3d, projecteer, type Hoeken } from './perspectief'
import { LOCATIES } from './locaties'

const SCHEEF: Hoeken = [[187.5, 280.5], [788.5, 402.8], [788.5, 647.1], [187.5, 666.7]]

describe('perspectief', () => {
  it('de hoeken van het design vallen precies op de hoeken van het scherm', () => {
    const [w, h] = [2112, 1152]
    const uit = ([[0, 0], [w, 0], [w, h], [0, h]] as const).map((p) => projecteer(SCHEEF, w, h, p))
    uit.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(SCHEEF[i][0], 6)
      expect(y).toBeCloseTo(SCHEEF[i][1], 6)
    })
  })

  it('een rechthoek op een rechthoek is gewoon schalen en verschuiven', () => {
    expect(matrix3d([[10, 20], [110, 20], [110, 70], [10, 70]], 200, 100)).toBe('matrix3d(0.5,0,0,0,0,0.5,0,0,0,0,1,0,10,20,0,1)')
  })

  it('het midden van het design schuift op naar de verre (kleinere) kant', () => {
    const [x] = projecteer(SCHEEF, 2112, 1152, [1056, 576])
    expect(x).toBeGreaterThan((187.5 + 788.5) / 2)
  })

  it('elke locatie heeft vier hoeken binnen de foto', () => {
    for (const l of Object.values(LOCATIES)) {
      expect(l.hoeken).toHaveLength(4)
      for (const [x, y] of l.hoeken) {
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(l.breedte)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(l.hoogte)
      }
    }
  })
})
