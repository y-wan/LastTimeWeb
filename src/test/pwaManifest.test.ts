import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pwaAssets } from '../../pwaManifest'

type Manifest = {
  id: string
  lang: string
  name: string
  short_name: string
  description: string
  theme_color: string
  background_color: string
  start_url: string
  scope: string
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>
}

const readManifest = (name: string) => JSON.parse(
  readFileSync(join(process.cwd(), 'public', name), 'utf8')
) as Manifest

const englishManifest = readManifest('manifest.en.webmanifest')
const chineseManifest = readManifest('manifest.zh-CN.webmanifest')

describe('PWA icon manifest', () => {
  it('keeps regular, Apple, and maskable artwork in separate roles', () => {
    const icons = englishManifest.icons
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
    expect(englishManifest.theme_color).toBe('#D65A3A')
    expect(englishManifest.background_color).toBe('#FAF7F3')
    expect(chineseManifest.theme_color).toBe(englishManifest.theme_color)
    expect(chineseManifest.background_color).toBe(englishManifest.background_color)
  })

  it('provides locale-specific top-level names with one stable app identity', () => {
    expect(englishManifest).toMatchObject({ id: './', lang: 'en', name: 'Last Time', short_name: 'Last Time' })
    expect(chineseManifest).toMatchObject({ id: './', lang: 'zh-CN', name: '上次', short_name: '上次' })
    expect(chineseManifest.description).toBe('记住每件事上次发生的时间。')
    expect(englishManifest.start_url).toBe(chineseManifest.start_url)
    expect(englishManifest.scope).toBe(chineseManifest.scope)
  })
})
