import { describe, expect, it } from 'vitest'
import { averageInterval, elapsedParts, formatInterval, formatSyncDateTime, formatSyncTime, historyGroup } from '../date'

describe('elapsed date behavior', () => {
  it('uses actual hours and minutes within the same calendar day', () => {
    expect(elapsedParts(new Date(2026, 8, 19, 8, 0), new Date(2026, 8, 19, 11, 45))).toEqual({ unit: 'hour', value: 3 })
    expect(elapsedParts(new Date(2026, 8, 19, 11, 30), new Date(2026, 8, 19, 11, 45))).toEqual({ unit: 'minute', value: 15 })
  })

  it('uses calendar-day distance as soon as local dates differ', () => {
    expect(elapsedParts(new Date(2026, 8, 18, 23, 55), new Date(2026, 8, 19, 0, 5))).toEqual({ unit: 'day', value: 1 })
  })

  it('groups today, recent seven days, earlier, and never', () => {
    const now = new Date(2026, 8, 19, 12)
    expect(historyGroup(new Date(2026, 8, 19, 1).toISOString(), now)).toBe('today')
    expect(historyGroup(new Date(2026, 8, 12, 23).toISOString(), now)).toBe('recent')
    expect(historyGroup(new Date(2026, 8, 11, 23).toISOString(), now)).toBe('earlier')
    expect(historyGroup(undefined, now)).toBe('never')
  })

  it('formats a successful sync as a local time without a permanent date', () => {
    const iso = '2026-09-19T05:23:48.000Z'
    expect(formatSyncTime(iso, 'en')).toBe(new Intl.DateTimeFormat('en', { timeStyle: 'medium' }).format(new Date(iso)))
  })

  it('formats the Settings last-sync value as a full local date and time', () => {
    const iso = '2026-09-19T05:23:48.000Z'
    expect(formatSyncDateTime(iso, 'zh-CN')).toBe(
      new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(iso))
    )
  })

  it('calculates average and per-record intervals for detail statistics', () => {
    const values = [
      '2026-09-01T00:00:00.000Z',
      '2026-09-04T00:00:00.000Z',
      '2026-09-09T00:00:00.000Z'
    ]
    expect(averageInterval(values)).toBe(4 * 86_400_000)
    expect(formatInterval(values[0], values[1], 'en')).toBe('3 days')
  })
})
