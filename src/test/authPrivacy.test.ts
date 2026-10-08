import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { localDocument } from '../onedrive'
import { exportCsv } from '../csv'
import { AUTH_STARTUP_PENDING_KEY, AUTH_STARTUP_REPORT_KEY, AuthStartupDiagnostics } from '../authStartupDiagnostics'

beforeEach(async () => {
  await db.events.clear()
  await db.occurrences.clear()
  await db.pendingOccurrenceDeletions.clear()
  await db.microsoftAuthState.clear()
  localStorage.removeItem(AUTH_STARTUP_PENDING_KEY)
  localStorage.removeItem(AUTH_STARTUP_REPORT_KEY)
})

describe('local Microsoft recovery privacy', () => {
  it('keeps both completed and pending startup diagnostics out of OneDrive and CSV data', async () => {
    const trace = new AuthStartupDiagnostics('1.0.11')
    trace.recordCachedAccount(true)
    trace.recordRecoverySkip('previous-attempt')
    trace.finish('connected')
    trace.beforeNavigation()
    expect(localStorage.getItem(AUTH_STARTUP_REPORT_KEY)).not.toBeNull()
    expect(localStorage.getItem(AUTH_STARTUP_PENDING_KEY)).not.toBeNull()
    const serialized = JSON.stringify(await localDocument())
    const portable = exportCsv([], [])
    for (const field of [
      'startupDiagnostics', 'cacheCounts', 'msalKeyCookieAtStart',
      'cachedAccountBeforeRedirectHandling', 'stagesMs', 'automaticRecoverySkipReason', 'previous-attempt'
    ]) {
      expect(serialized).not.toContain(field)
      expect(portable).not.toContain(field)
    }
    expect(Object.keys(JSON.parse(serialized))).toEqual(['version', 'updatedAt', 'events', 'occurrences'])
  })
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
