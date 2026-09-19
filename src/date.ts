import type { Locale } from './types'

const DAY_MS = 86_400_000

function calendarDayNumber(date: Date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)
}

export function elapsedParts(from: Date, to = new Date()) {
  const calendarDays = calendarDayNumber(to) - calendarDayNumber(from)
  if (calendarDays !== 0) return { unit: 'day' as const, value: calendarDays }
  const minutes = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000))
  if (minutes >= 60) return { unit: 'hour' as const, value: Math.floor(minutes / 60) }
  return { unit: 'minute' as const, value: minutes }
}

export function formatElapsed(from: string | undefined, locale: Locale, now = new Date()) {
  if (!from) return locale === 'zh-CN' ? '从未记录' : 'Never'
  const { unit, value } = elapsedParts(new Date(from), now)
  if (locale === 'zh-CN') {
    return unit === 'day' ? `${value} 天前` : unit === 'hour' ? `${value} 小时前` : `${value} 分钟前`
  }
  return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(-value, unit)
}

export function historyGroup(occurredAt: string | undefined, now = new Date()) {
  if (!occurredAt) return 'never' as const
  const days = calendarDayNumber(now) - calendarDayNumber(new Date(occurredAt))
  if (days === 0) return 'today' as const
  if (days <= 7) return 'recent' as const
  return 'earlier' as const
}

export function toLocalInputValue(iso: string) {
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function formatSyncTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(new Date(iso))
}
