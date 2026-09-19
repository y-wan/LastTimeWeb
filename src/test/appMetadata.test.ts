import { beforeEach, describe, expect, it } from 'vitest'
import {
  APP_LOCALE_STORAGE_KEY,
  applyLocalizedAppMetadata,
  initialAppLocale,
  installedAppName,
  isChineseLocale,
  localizedManifestHref,
  normalizedAppLocale,
  readPersistedAppLocale
} from '../appMetadata'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.lang = 'en'
  document.head.innerHTML = '<title>Fallback</title><meta name="apple-mobile-web-app-title" content="Fallback" /><link rel="manifest" href="./manifest.en.webmanifest" />'
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

  it('uses a persisted app language before the browser language', () => {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, 'zh-CN')
    expect(readPersistedAppLocale()).toBe('zh-CN')
    expect(initialAppLocale('en-US')).toBe('zh-CN')
    expect(normalizedAppLocale('en-US')).toBe('en')
    expect(localizedManifestHref('zh-CN')).toBe('./manifest.zh-CN.webmanifest')
  })

  it('updates all install metadata and the synchronous language mirror', () => {
    expect(applyLocalizedAppMetadata('zh-CN')).toBe('上次')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.title).toBe('上次')
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('上次')
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('./manifest.zh-CN.webmanifest')
    expect(localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe('zh-CN')

    applyLocalizedAppMetadata('en-US')
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('Last Time')
    expect(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('Last Time')
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('./manifest.en.webmanifest')
    expect(localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe('en')
  })
})
