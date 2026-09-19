import { describe, expect, it } from 'vitest'
import { canonicalStringify, mergeDocuments, mergeRecords } from '../sync'
import type { EventRecord, OccurrenceRecord, SyncDocument } from '../types'

const event = (updatedAt: string, name: string, deletedAt?: string): EventRecord => ({
  id: 'event-1', name, note: '', icon: 'clock', color: '#e66d5b',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt, deletedAt
})

describe('sync merge', () => {
  it('chooses the most recently updated record, including tombstones', () => {
    expect(mergeRecords([event('2026-01-02T00:00:00.000Z', 'local')], [event('2026-01-03T00:00:00.000Z', 'remote')])[0].name).toBe('remote')
    expect(mergeRecords([event('2026-01-04T00:00:00.000Z', 'deleted', '2026-01-04T00:00:00.000Z')], [event('2026-01-03T00:00:00.000Z', 'remote')])[0].deletedAt).toBeTruthy()
  })

  it('breaks equal-timestamp conflicts deterministically', () => {
    const left = event('2026-01-02T00:00:00.000Z', 'alpha')
    const right = event('2026-01-02T00:00:00.000Z', 'omega')
    expect(mergeRecords([left], [right])).toEqual(mergeRecords([right], [left]))
  })

  it('prefers deletion over a live record at the same timestamp', () => {
    const live = event('2026-01-02T00:00:00.000Z', 'live')
    const deleted = event('2026-01-02T00:00:00.000Z', 'deleted', '2026-01-02T00:00:00.000Z')
    expect(mergeRecords([live], [deleted])[0].deletedAt).toBeTruthy()
    expect(mergeRecords([deleted], [live])[0].deletedAt).toBeTruthy()
  })

  it('canonicalizes property order before equal-time tie-breaking', () => {
    const left = { id: '1', nested: { beta: 2, alpha: 1 }, name: 'same' }
    const right = { name: 'same', nested: { alpha: 1, beta: 2 }, id: '1' }
    expect(canonicalStringify(left)).toBe(canonicalStringify(right))
  })

  it('prevents duplicate occurrences by stable UUID', () => {
    const occurrence: OccurrenceRecord = {
      id: 'occurrence-1', eventId: 'event-1', occurredAt: '2026-01-02T00:00:00.000Z',
      note: '', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z'
    }
    const local: SyncDocument = { version: 1, updatedAt: occurrence.updatedAt, events: [], occurrences: [occurrence] }
    const remote: SyncDocument = { ...local, occurrences: [{ ...occurrence }] }
    expect(mergeDocuments(local, remote).occurrences).toHaveLength(1)
  })
})
