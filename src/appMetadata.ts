import type { Locale } from './types'

export const APP_LOCALE_STORAGE_KEY = 'last-time-app-locale'

export function isChineseLocale(locale: string | undefined) {
  return locale?.toLowerCase().startsWith('zh') ?? false
}

export function normalizedAppLocale(locale: string | undefined): Locale {
  return isChineseLocale(locale) ? 'zh-CN' : 'en'
}

export function readPersistedAppLocale(storage: Pick<Storage, 'getItem'> = localStorage): Locale | undefined {
  try {
    const locale = storage.getItem(APP_LOCALE_STORAGE_KEY)
    return locale === 'zh-CN' || locale === 'en' ? locale : undefined
  } catch (error) {
    console.warn('Unable to read the persisted app language.', error)
    return undefined
  }
}

export function initialAppLocale(browserLocale: string | undefined) {
  return readPersistedAppLocale() ?? normalizedAppLocale(browserLocale)
}

export function localizedManifestHref(locale: string | undefined) {
  return isChineseLocale(locale) ? './manifest.zh-CN.webmanifest' : './manifest.en.webmanifest'
}

export function installedAppName(locale: string | undefined) {
  return isChineseLocale(locale) ? '上次' : 'Last Time'
}

export function applyLocalizedAppMetadata(locale: string | undefined) {
  const normalizedLocale = normalizedAppLocale(locale)
  const name = installedAppName(locale)
  document.documentElement.lang = normalizedLocale
  document.title = name
  document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name)
  const manifestHref = localizedManifestHref(normalizedLocale)
  const currentManifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (currentManifest?.getAttribute('href') !== manifestHref) {
    const manifest = document.createElement('link')
    manifest.rel = 'manifest'
    manifest.href = manifestHref
    if (currentManifest) currentManifest.replaceWith(manifest)
    else document.head.appendChild(manifest)
  }
  try {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, normalizedLocale)
  } catch (error) {
    console.warn('Unable to persist the app language for install metadata.', error)
  }
  return name
}
