import { describe, expect, it } from 'vitest'
import { pwaAssets, pwaManifest } from '../../pwaManifest'

describe('PWA icon manifest', () => {
  it('keeps regular, Apple, and maskable artwork in separate roles', () => {
    const icons = pwaManifest.icons ?? []
    expect(pwaAssets).toContain('apple-touch-icon-180.png')
    expect(icons.filter((icon) => icon.purpose === 'any').map((icon) => [icon.src, icon.sizes])).toEqual([
      ['app-icon.svg', 'any'],
      ['app-icon-192.png', '192x192'],
      ['app-icon-512.png', '512x512']
    ])
    expect(icons.filter((icon) => icon.purpose === 'maskable').map((icon) => [icon.src, icon.sizes])).toEqual([
      ['app-icon-maskable-192.png', '192x192'],
      ['app-icon-maskable-512.png', '512x512']
    ])
    expect(icons.every((icon) => !String(icon.purpose).includes(' '))).toBe(true)
  })

  it('uses the current Ember launch colors', () => {
    expect(pwaManifest.theme_color).toBe('#D65A3A')
    expect(pwaManifest.background_color).toBe('#FAF7F3')
  })

  it('provides standards-based Chinese localized install metadata with an English base', () => {
    expect(pwaManifest.name).toBe('Last Time')
    expect(pwaManifest.short_name).toBe('Last Time')
    expect(pwaManifest.name_localized.zh).toEqual({ value: '上次' })
    expect(pwaManifest.name_localized['zh-CN']).toEqual({ value: '上次' })
    expect(pwaManifest.short_name_localized.zh).toEqual({ value: '上次' })
    expect(pwaManifest.description_localized['zh-CN']).toEqual({ value: '记住某件事上次发生的时间。' })
  })
})
