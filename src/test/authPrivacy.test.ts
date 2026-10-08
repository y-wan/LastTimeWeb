import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { localDocument } from '../onedrive'
import { exportCsv } from '../csv'

beforeEach(async () => {
  await db.events.clear()
  await db.occurrences.clear()
  await db.pendingOccurrenceDeletions.clear()
  await db.microsoftAuthState.clear()
})

describe('local Microsoft recovery privacy', () => {
  it('never serializes the marker or login hint into the OneDrive document', async () => {
    await db.microsoftAuthState.put({
      key: 'microsoft',
      connectedBefore: true,
      loginHint: 'private-person@example.com',
      coldStartRecovery: { homeAccountId: 'private-recovery-account' }
    })

    const serialized = JSON.stringify(await localDocument())
    expect(serialized).not.toContain('private-person@example.com')
    expect(serialized).not.toContain('connectedBefore')
    expect(serialized).not.toContain('coldStartRecovery')
    expect(serialized).not.toContain('private-recovery-account')
    expect(Object.keys(JSON.parse(serialized))).toEqual(['version', 'updatedAt', 'events', 'occurrences'])
    const portable = exportCsv([], [])
    expect(portable).not.toContain('private-person@example.com')
    expect(portable).not.toContain('coldStartRecovery')
    expect(portable).not.toContain('private-recovery-account')
  })

  it('projects durable pending undo intents as tombstones in the sync snapshot', async () => {
    await db.occurrences.add({
      id: 'occurrence-pending',
      eventId: 'event-1',
      occurredAt: '2026-09-19T00:00:00.000Z',
      note: '',
      createdAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-19T00:00:00.000Z'
    })
    await db.pendingOccurrenceDeletions.put({
      occurrenceId: 'occurrence-pending',
      requestedAt: '2026-09-20T00:00:00.000Z'
    })

    expect((await localDocument()).occurrences[0]).toMatchObject({
      id: 'occurrence-pending',
      deletedAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z'
    })
  })
})
