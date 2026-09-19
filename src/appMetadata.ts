export function isChineseLocale(locale: string | undefined) {
  return locale?.toLowerCase().startsWith('zh') ?? false
}

export function installedAppName(locale: string | undefined) {
  return isChineseLocale(locale) ? '上次' : 'Last Time'
}

export function applyLocalizedAppMetadata(locale: string | undefined) {
  const name = installedAppName(locale)
  document.title = name
  document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name)
  return name
}
