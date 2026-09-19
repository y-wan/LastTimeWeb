import { describe, expect, it } from 'vitest'
import { accessibleForeground, contrastRatio } from '../colorContrast'
import { EVENT_COLORS } from '../eventOptions'

const surfaces = [
  '#FFFDFC', '#252220',
  '#F7F9FC', '#171B22',
  '#FAF8F1', '#1B1D18',
  '#FAF7FC', '#1D1922',
  '#F7F6F3', '#191B1B'
]

describe('accessible event foregrounds', () => {
  it('reaches WCAG 4.5:1 for every Android color on all light and dark theme surfaces', () => {
    for (const surface of surfaces) {
      for (const color of EVENT_COLORS) {
        expect(contrastRatio(accessibleForeground(color, surface), surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('adjusts imported colors without changing colors that already meet contrast', () => {
    expect(contrastRatio(accessibleForeground('#ABCDEF', '#FFFDFC'), '#FFFDFC')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(accessibleForeground('#123456', '#171B22'), '#171B22')).toBeGreaterThanOrEqual(4.5)
    expect(accessibleForeground('#4D73BE', '#FFFDFC')).toBe('#4D73BE')
  })
})
