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

export function formatSyncDateTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(iso))
}

export function formatInterval(from: string, to: string, locale: Locale) {
  const milliseconds = Math.max(0, new Date(to).getTime() - new Date(from).getTime())
  const days = Math.floor(milliseconds / DAY_MS)
  if (days > 0) return locale === 'zh-CN' ? `${days} 天` : `${days} ${days === 1 ? 'day' : 'days'}`
  const hours = Math.floor(milliseconds / 3_600_000)
  if (hours > 0) return locale === 'zh-CN' ? `${hours} 小时` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const minutes = Math.max(1, Math.floor(milliseconds / 60_000))
  return locale === 'zh-CN' ? `${minutes} 分钟` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

export function averageInterval(occurrences: string[]) {
  if (occurrences.length < 2) return undefined
  const sorted = occurrences.map((value) => new Date(value).getTime()).sort((a, b) => a - b)
  const total = sorted.slice(1).reduce((sum, value, index) => sum + value - sorted[index], 0)
  return total / (sorted.length - 1)
}

export function formatDuration(milliseconds: number, locale: Locale) {
  const days = Math.round(milliseconds / DAY_MS)
  if (days >= 1) return locale === 'zh-CN' ? `约 ${days} 天` : `About ${days} ${days === 1 ? 'day' : 'days'}`
  const hours = Math.max(1, Math.round(milliseconds / 3_600_000))
  return locale === 'zh-CN' ? `约 ${hours} 小时` : `About ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}
