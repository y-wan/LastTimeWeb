import { describe, expect, it } from 'vitest'
import { accessibleForeground, contrastRatio } from '../colorContrast'
import { EVENT_COLORS } from '../eventOptions'
import { THEME_PALETTES } from '../themePalettes'

describe('accessible event foregrounds', () => {
  it('covers all 50 Android event-color and theme-surface combinations at WCAG 4.5:1', () => {
    let combinations = 0
    for (const palette of THEME_PALETTES) {
      for (const roles of [palette.light, palette.dark]) {
        for (const color of EVENT_COLORS) {
          expect(contrastRatio(accessibleForeground(color, roles.surface), roles.surface)).toBeGreaterThanOrEqual(4.5)
          combinations++
        }
      }
    }
    expect(combinations).toBe(50)
  })

  it('adjusts imported colors without changing colors that already meet contrast', () => {
    expect(contrastRatio(accessibleForeground('#ABCDEF', '#FFFDFC'), '#FFFDFC')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(accessibleForeground('#123456', '#171B22'), '#171B22')).toBeGreaterThanOrEqual(4.5)
    expect(accessibleForeground('#4D73BE', '#FFFDFC')).toBe('#4D73BE')
  })
})
