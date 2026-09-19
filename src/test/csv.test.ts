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

  it('groups legacy iOS rows by trimmed event name and assigns generic Note to occurrences', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn()
        .mockReturnValueOnce('event-new')
        .mockReturnValueOnce('occ-one')
        .mockReturnValueOnce('occ-two')
    })
    const imported = importCsv([
      'Event,Note,Date,Time,Timestamp,icon,color',
      ' Synthetic routine ,First occurrence,,,1767225600,cleaning,#FF238C82',
      'Synthetic routine,Second occurrence,,,1767312000,cleaning,#FF238C82'
    ].join('\n'), new Date('2026-12-01T00:00:00.000Z'))
    expect(imported.events).toHaveLength(1)
    expect(imported.events[0]).toMatchObject({ name: 'Synthetic routine', note: '', icon: 'cleaning', color: '#238C82' })
    expect(imported.occurrences).toHaveLength(2)
    expect(imported.occurrences.map((item) => item.note)).toEqual(['First occurrence', 'Second occurrence'])
    expect(new Set(imported.occurrences.map((item) => item.eventId))).toEqual(new Set(['event-new']))
    vi.unstubAllGlobals()
  })

  it('keeps explicit event and occurrence note aliases at their intended levels', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValueOnce('event-new').mockReturnValueOnce('occ-new')
    })
    const imported = importCsv('Event,event_notes,occurrence_notes,occurredAt\nSynthetic item,Event context,Occurrence context,2026-01-01T00:00:00.000Z', new Date('2026-12-01T00:00:00.000Z'))
    expect(imported.events[0].note).toBe('Event context')
    expect(imported.occurrences[0].note).toBe('Occurrence context')
    vi.unstubAllGlobals()
  })

  it('uses generic Note as an event note when the schema has no occurrence fields', () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('event-new') })
    const imported = importCsv('Event,Note\nSynthetic item,Event context')
    expect(imported.events[0].note).toBe('Event context')
    expect(imported.occurrences).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('continues to reject future occurrence timestamps', () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('event-new') })
    const imported = importCsv('Event,Note,Timestamp\nSynthetic item,Future note,1893456000', new Date('2026-01-01T00:00:00.000Z'))
    expect(imported.events).toHaveLength(1)
    expect(imported.occurrences).toHaveLength(0)
    vi.unstubAllGlobals()
  })
})
