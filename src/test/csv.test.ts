import { beforeEach, describe, expect, it } from 'vitest'
import { exportCsv, importCsv } from '../csv'
import { db, importRecords } from '../db'
import { mergeDocuments } from '../sync'
import type { EventRecord, OccurrenceRecord } from '../types'

beforeEach(async () => {
  await db.events.clear()
  await db.occurrences.clear()
  await db.microsoftAuthState.clear()
})

describe('CSV portability', () => {
  it('never includes the local Microsoft login hint', async () => {
    await db.microsoftAuthState.put({
      key: 'microsoft',
      connectedBefore: true,
      loginHint: 'private-person@example.com'
    })
    expect(exportCsv([], [])).not.toContain('private-person@example.com')
  })

  it('round-trips stable IDs, names, notes, icon, color, and timestamps', async () => {
    const event: EventRecord = {
      id: 'event-1', name: 'Wash "car"', note: 'Before, rain', icon: 'car', color: '#177b78',
      createdAt: '2026-01-01T02:00:00.000Z', updatedAt: '2026-01-01T02:00:00.000Z'
    }
    const occurrence: OccurrenceRecord = {
      id: 'occ-1', eventId: event.id, occurredAt: '2026-02-03T04:05:00.000Z', note: 'Quick, wash',
      createdAt: '2026-02-03T04:05:00.000Z', updatedAt: '2026-02-03T04:05:00.000Z'
    }
    const csv = exportCsv([event], [occurrence])
    expect(csv.split('\r\n')[0]).toContain('"Event ID"')
    expect(csv.split('\r\n')[0]).toContain('"Occurrence ID"')
    const imported = await importCsv(csv, new Date('2026-03-01T00:00:00.000Z'))
    expect(imported.events[0]).toEqual(event)
    expect(imported.occurrences[0]).toEqual(occurrence)
  })

  it('normalizes Android ARGB colors and legacy web icon aliases on import', async () => {
    const imported = await importCsv('Event,Icon,Color\nLegacy grooming,scissors,#FFF2A65A')
    expect(imported.events[0]).toMatchObject({ icon: 'grooming', color: '#F2A65A' })
  })

  it('groups legacy iOS rows by normalized event name and assigns generic Note to occurrences', async () => {
    const imported = await importCsv([
      'Event,Note,Date,Time,Timestamp,icon,color',
      ' Synthetic routine ,First occurrence,,,1767225600,cleaning,#FF238C82',
      'SYNTHETIC   ROUTINE,Second occurrence,,,1767312000,cleaning,#FF238C82'
    ].join('\n'), new Date('2026-12-01T00:00:00.000Z'))
    expect(imported.events).toHaveLength(1)
    expect(imported.events[0]).toMatchObject({ name: 'Synthetic routine', note: '', icon: 'cleaning', color: '#238C82' })
    expect(imported.occurrences).toHaveLength(2)
    expect(imported.occurrences.map((item) => item.note)).toEqual(['First occurrence', 'Second occurrence'])
    expect(new Set(imported.occurrences.map((item) => item.eventId)).size).toBe(1)
  })

  it('keeps explicit event and occurrence note aliases at their intended levels', async () => {
    const imported = await importCsv('Event,event_notes,occurrence_notes,occurredAt\nSynthetic item,Event context,Occurrence context,2026-01-01T00:00:00.000Z', new Date('2026-12-01T00:00:00.000Z'))
    expect(imported.events[0].note).toBe('Event context')
    expect(imported.occurrences[0].note).toBe('Occurrence context')
  })

  it('uses generic Note as an event note when the schema has no occurrence fields', async () => {
    const imported = await importCsv('Event,Note\nSynthetic item,Event context')
    expect(imported.events[0].note).toBe('Event context')
    expect(imported.occurrences).toHaveLength(0)
  })

  it('continues to reject future occurrence timestamps', async () => {
    const imported = await importCsv('Event,Note,Timestamp\nSynthetic item,Future note,1893456000', new Date('2026-01-01T00:00:00.000Z'))
    expect(imported.events).toHaveLength(1)
    expect(imported.occurrences).toHaveLength(0)
  })

  it('uses deterministic opaque IDs across devices and repeated imports', async () => {
    const rows = ['Event,Note,Timestamp']
    for (let occurrence = 0; occurrence < 908; occurrence++) {
      const event = `Synthetic item ${String(occurrence % 14 + 1).padStart(2, '0')}`
      rows.push(`${event},Record ${occurrence + 1},${1767225600 + occurrence * 60}`)
    }
    const csv = rows.join('\n')
    const firstDevice = await importCsv(csv, new Date('2026-02-01T00:00:00.000Z'))
    const secondDevice = await importCsv(csv, new Date('2026-02-02T00:00:00.000Z'))
    expect(firstDevice.events).toHaveLength(14)
    expect(firstDevice.occurrences).toHaveLength(908)
    expect(secondDevice.events.map((item) => item.id)).toEqual(firstDevice.events.map((item) => item.id))
    expect(secondDevice.occurrences.map((item) => item.id)).toEqual(firstDevice.occurrences.map((item) => item.id))
    expect(firstDevice.events.every((item) => !item.id.includes('Synthetic'))).toBe(true)

    await importRecords(firstDevice.events, firstDevice.occurrences)
    await importRecords(secondDevice.events, secondDevice.occurrences)
    expect(await db.events.count()).toBe(14)
    expect(await db.occurrences.count()).toBe(908)

    const merged = mergeDocuments(
      { version: 1, updatedAt: '2026-02-01T00:00:00.000Z', ...firstDevice },
      { version: 1, updatedAt: '2026-02-02T00:00:00.000Z', ...secondDevice }
    )
    expect(merged.events).toHaveLength(14)
    expect(merged.occurrences).toHaveLength(908)
    expect(merged.occurrences.find((item) => item.note === 'Record 908')).toBeDefined()
  })

  it('deduplicates the same event timestamp but preserves explicit IDs when supplied', async () => {
    const withoutIds = await importCsv([
      'Event,Note,Timestamp',
      'Synthetic item,First note,1767225600',
      'Synthetic item,Corrected note,1767225600'
    ].join('\n'), new Date('2026-02-01T00:00:00.000Z'))
    expect(withoutIds.events).toHaveLength(1)
    expect(withoutIds.occurrences).toHaveLength(1)
    expect(withoutIds.occurrences[0].note).toBe('Corrected note')

    const explicit = await importCsv([
      'Event ID,Event,Occurrence ID,Occurrence,Occurrence Note',
      'source-event,Synthetic item,source-occurrence-a,2026-01-01T00:00:00.000Z,First',
      'source-event,Synthetic item,source-occurrence-b,2026-01-01T00:00:00.000Z,Second'
    ].join('\n'), new Date('2026-02-01T00:00:00.000Z'))
    expect(explicit.events[0].id).toBe('source-event')
    expect(explicit.occurrences.map((item) => item.id)).toEqual(['source-occurrence-a', 'source-occurrence-b'])
  })

  it('uses later import time as the LWW update for changed no-ID content', async () => {
    const original = await importCsv(
      'Event,Event Note,Occurrence,Occurrence Note\nSynthetic item,Original event note,2026-01-01T00:00:00.000Z,Original record note',
      new Date('2026-02-01T00:00:00.000Z')
    )
    const corrected = await importCsv(
      'Event,Event Note,Occurrence,Occurrence Note\nSynthetic item,Corrected event note,2026-01-01T00:00:00.000Z,Corrected record note',
      new Date('2026-02-02T00:00:00.000Z')
    )
    const merged = mergeDocuments(
      { version: 1, updatedAt: '2026-02-01T00:00:00.000Z', ...original },
      { version: 1, updatedAt: '2026-02-02T00:00:00.000Z', ...corrected }
    )
    expect(merged.events).toHaveLength(1)
    expect(merged.events[0].note).toBe('Corrected event note')
    expect(merged.occurrences).toHaveLength(1)
    expect(merged.occurrences[0].note).toBe('Corrected record note')
  })
})
