import { beforeEach, describe, expect, it } from 'vitest'
import { applyLocalizedAppMetadata, installedAppName, isChineseLocale } from '../appMetadata'

beforeEach(() => {
  document.head.innerHTML = '<title>Fallback</title><meta name="apple-mobile-web-app-title" content="Fallback" />'
})

describe('localized installed app metadata', () => {
  it('detects Chinese language tags without treating other locales as Chinese', () => {
    expect(isChineseLocale('zh-CN')).toBe(true)
    expect(isChineseLocale('zh-TW')).toBe(true)
    expect(isChineseLocale('en-US')).toBe(false)
    expect(isChineseLocale(undefined)).toBe(false)
  })

  it('uses the Chinese name for zh-CN and generic zh system languages', () => {
    expect(installedAppName('zh-CN')).toBe('上次')
    expect(installedAppName('zh-TW')).toBe('上次')
    expect(installedAppName('zh')).toBe('上次')
  })

  it('falls back to English for English, other, or missing locales', () => {
    expect(installedAppName('en-US')).toBe('Last Time')
    expect(installedAppName('fr-FR')).toBe('Last Time')
    expect(installedAppName(undefined)).toBe('Last Time')
  })

  it('updates the document title and iOS home-screen title metadata', () => {
    expect(applyLocalizedAppMetadata('zh-CN')).toBe('上次')
    expect(document.title).toBe('上次')
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('上次')

    applyLocalizedAppMetadata('en-US')
    expect(document.title).toBe('Last Time')
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('Last Time')
  })
})
