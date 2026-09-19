import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PalettePreview } from '../App'
import { resolvedPaletteRoles, THEME_PALETTES } from '../themePalettes'

describe('Settings palette previews', () => {
  const asRgb = (hex: string) => {
    const value = hex.replace('#', '')
    return `rgb(${[0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16)).join(', ')})`
  }

  it.each([
    ['light', false, 'light'],
    ['dark', false, 'dark'],
    ['system', true, 'dark']
  ] as const)('renders all five palettes with %s appearance resolved to %s roles', (theme, systemDark, expectedMode) => {
    for (const palette of THEME_PALETTES) {
      const roles = resolvedPaletteRoles(palette.id, theme, systemDark)
      expect(roles).toBe(palette[expectedMode])
      const { container, unmount } = render(<PalettePreview roles={roles} />)
      const preview = container.querySelector<HTMLElement>('.palette-preview')
      expect(preview?.style.background).toBe(asRgb(roles.background))
      expect(container.querySelector<HTMLElement>('.preview-surface')?.style.background).toBe(asRgb(roles.surfaceHigh))
      expect(container.querySelector<HTMLElement>('.preview-primary')?.style.background).toBe(asRgb(roles.primary))
      expect(container.querySelector<HTMLElement>('.preview-secondary')?.style.background).toBe(asRgb(roles.secondary))
      expect(container.querySelector<HTMLElement>('.preview-tertiary')?.style.background).toBe(asRgb(roles.tertiary))
      unmount()
    }
  })
})
