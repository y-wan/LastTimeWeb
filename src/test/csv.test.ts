import { describe, expect, it, vi } from 'vitest'
import { exportCsv, importCsv } from '../csv'
import type { EventRecord, OccurrenceRecord } from '../types'

describe('CSV portability', () => {
  it('round-trips names, notes, icon, color, created time, and occurrence data', () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('event-new').mockReturnValueOnce('occ-new') })
    const event: EventRecord = {
      id: 'event-1', name: 'Wash "car"', note: 'Before, rain', icon: 'car', color: '#177b78',
      createdAt: '2026-01-01T02:00:00.000Z', updatedAt: '2026-01-01T02:00:00.000Z'
    }
    const occurrence: OccurrenceRecord = {
      id: 'occ-1', eventId: event.id, occurredAt: '2026-02-03T04:05:00.000Z', note: 'Quick, wash',
      createdAt: '2026-02-03T04:05:00.000Z', updatedAt: '2026-02-03T04:05:00.000Z'
    }
    const imported = importCsv(exportCsv([event], [occurrence]), new Date('2026-03-01T00:00:00.000Z'))
    expect(imported.events[0]).toMatchObject({
      name: event.name, note: event.note, icon: event.icon, color: event.color, createdAt: event.createdAt
    })

    expect(imported.occurrences[0]).toMatchObject({ occurredAt: occurrence.occurredAt, note: occurrence.note })
    vi.unstubAllGlobals()
  })

  it('normalizes Android ARGB colors and legacy web icon aliases on import', () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('event-new') })
    const imported = importCsv('Event,Icon,Color\nLegacy grooming,scissors,#FFF2A65A')
    expect(imported.events[0]).toMatchObject({ icon: 'grooming', color: '#F2A65A' })
    vi.unstubAllGlobals()
  })

  it('imports the iOS Event, Note, Date, Time, Timestamp shape', () => {
    const imported = importCsv('Event,Note,Date,Time,Timestamp\nHaircut,Short,,,1767225600', new Date('2026-12-01T00:00:00.000Z'))
    expect(imported.events[0]).toMatchObject({ name: 'Haircut', note: 'Short' })
    expect(imported.occurrences[0].occurredAt).toBe('2026-01-01T00:00:00.000Z')
  })
})
