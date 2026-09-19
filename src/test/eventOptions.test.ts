import { describe, expect, it } from 'vitest'
import { EVENT_COLORS, normalizeEventColor } from '../eventOptions'

describe('Android event color parity', () => {
  it('uses exactly the five Android editor colors', () => {
    expect(EVENT_COLORS).toEqual(['#E86F51', '#238C82', '#F2A65A', '#4D73BE', '#9A5A78'])
  })

  it('converts Android ARGB colors to portable RGB while retaining custom RGB colors', () => {
    expect(normalizeEventColor('#FFE86F51')).toBe('#E86F51')
    expect(normalizeEventColor('0xFF238C82')).toBe('#238C82')
    expect(normalizeEventColor(String(0xFFF2A65A >> 0))).toBe('#F2A65A')
    expect(normalizeEventColor('#177b78')).toBe('#177b78')
  })
})
