import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../colorContrast'
import { resolvedPaletteRoles, THEME_PALETTES } from '../themePalettes'

const anchors = {
  vitalOrange: ['#D65A3A', '#0F8C80', '#D9982E', '#FAF7F3', '#FFFFFF'],
  mistBlue: ['#3F6FD4', '#0D8B9A', '#795CC2', '#F4F7FB', '#FFFFFF'],
  sage: ['#4F7F55', '#C45F45', '#A67834', '#F6F8F2', '#FFFFFF'],
  softPurple: ['#7655C6', '#C44F78', '#397F98', '#F8F5FB', '#FFFFFF'],
  quietGray: ['#3C6975', '#367E69', '#B96742', '#F4F7F7', '#FFFFFF']
} as const

describe('role-based theme palettes', () => {
  it.each(THEME_PALETTES)('uses the approved $id anchors and distinct elevated surfaces', (palette) => {
    expect([
      palette.light.primary,
      palette.light.secondary,
      palette.light.tertiary,
      palette.light.background,
      palette.light.surface
    ]).toEqual(anchors[palette.id])
    expect(palette.light.background).not.toBe(palette.light.surface)
    expect(palette.dark.background).not.toBe(palette.dark.surface)
    expect(palette.dark.surface).not.toBe(palette.dark.surfaceHigh)
  })

  it.each(THEME_PALETTES.flatMap((palette) => [
    [palette.id, 'light', palette.light] as const,
    [palette.id, 'dark', palette.dark] as const
  ]))('%s %s roles meet 4.5:1 for text and control content', (_id, _mode, roles) => {
    const pairs = [
      ['text/background', roles.text, roles.background],
      ['text/surface', roles.text, roles.surface],
      ['muted/background', roles.muted, roles.background],
      ['muted/surface', roles.muted, roles.surface],
      ['primary/onPrimary', roles.primary, roles.onPrimary],
      ['secondary/onSecondary', roles.secondary, roles.onSecondary],
      ['tertiary/onTertiary', roles.tertiary, roles.onTertiary],
      ['tertiaryText/background', roles.tertiaryText, roles.background],
      ['tertiaryText/surface', roles.tertiaryText, roles.surface],
      ['primaryContainer/onPrimaryContainer', roles.primaryContainer, roles.onPrimaryContainer],
      ['secondaryContainer/onSecondaryContainer', roles.secondaryContainer, roles.onSecondaryContainer],
      ['primaryText/background', roles.primaryText, roles.background],
      ['primaryText/surface', roles.primaryText, roles.surface],
      ['secondaryText/background', roles.secondaryText, roles.background],
      ['secondaryText/surface', roles.secondaryText, roles.surface]
    ] as const
    for (const [name, first, second] of pairs) {
      expect(contrastRatio(first, second), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('resolves system appearance using the current color-scheme', () => {
    for (const palette of THEME_PALETTES) {
      expect(resolvedPaletteRoles(palette.id, 'light', true)).toBe(palette.light)
      expect(resolvedPaletteRoles(palette.id, 'dark', false)).toBe(palette.dark)
      expect(resolvedPaletteRoles(palette.id, 'system', false)).toBe(palette.light)
      expect(resolvedPaletteRoles(palette.id, 'system', true)).toBe(palette.dark)
    }
  })
})
