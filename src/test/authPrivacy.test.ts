import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { localDocument } from '../onedrive'
import { exportCsv } from '../csv'
import { AUTH_STARTUP_PENDING_KEY, AUTH_STARTUP_REPORT_KEY, AuthStartupDiagnostics } from '../authStartupDiagnostics'
import { AUTH_STARTUP_BASELINE_KEY } from '../authCacheEvidence'
import { Notice } from '../notifications'

beforeEach(async () => {
  await db.events.clear()
  await db.occurrences.clear()
  await db.pendingOccurrenceDeletions.clear()
  await db.microsoftAuthState.clear()
  localStorage.removeItem(AUTH_STARTUP_PENDING_KEY)
  localStorage.removeItem(AUTH_STARTUP_REPORT_KEY)
  localStorage.removeItem(AUTH_STARTUP_BASELINE_KEY)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('local Microsoft recovery privacy', () => {
  it('keeps completed, pending and successful-baseline diagnostics out of OneDrive and CSV data', async () => {
    const trace = new AuthStartupDiagnostics('1.0.12')
    trace.recordCacheEvidence('beforeInitialize')
    trace.recordCacheEvidence('afterInitialize')
    await trace.measure('silent', async () => 'private-token', 'acquireTokenSilent')
    trace.recordCachedAccount(true)
    trace.recordRecoverySkip('previous-attempt')
    trace.finish('connected')
    trace.beforeNavigation()
    expect(localStorage.getItem(AUTH_STARTUP_REPORT_KEY)).not.toBeNull()
    expect(localStorage.getItem(AUTH_STARTUP_PENDING_KEY)).not.toBeNull()
    expect(localStorage.getItem(AUTH_STARTUP_BASELINE_KEY)).not.toBeNull()
    const serialized = JSON.stringify(await localDocument())
    const portable = exportCsv([], [])
    for (const field of [
      'startupDiagnostics', 'cacheCounts', 'msalKeyCookieAtStart',
      'cacheEvidence', 'lastSuccessfulAuth', 'beforeInitialize', 'afterInitialize', 'usableAccountCountAfterRedirectHandling',
      'cachedAccountBeforeRedirectHandling', 'stagesMs', 'automaticRecoverySkipReason', 'previous-attempt'
    ]) {
      expect(serialized).not.toContain(field)
      expect(portable).not.toContain(field)
    }
    expect(Object.keys(JSON.parse(serialized))).toEqual(['version', 'updatedAt', 'events', 'occurrences'])
  })
  it('keeps sensitive cache fixtures out of actual persisted, copied, logged and exported payloads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const key = 'private-account-storage-key'
    const raw = JSON.stringify({ id: 'private-encryption-id', nonce: 'private-nonce', data: 'private-token' })
    const cookie = encodeURIComponent(JSON.stringify({ id: 'private-encryption-id', key: 'private-cookie-key' }))
    localStorage.setItem('msal.2.account.keys', JSON.stringify([key]))
    localStorage.setItem(key, raw)
    document.cookie = `msal.cache.encryption=${cookie}; path=/`
    try {
      const trace = new AuthStartupDiagnostics('1.0.12')
      trace.recordCacheEvidence('beforeInitialize')
      trace.recordCacheEvidence('afterInitialize')
      trace.recordPerformance([{
        name: 'initializeClientApplication', encryptedCacheCount: 1,
        accountId: 'private-account-id', correlationId: 'private-correlation',
        errorMessage: 'private-error', accessToken: 'private-token',
        url: 'https://private.example.com', hash: 'private-hash', log: 'private-sdk-log'
      }])
      await trace.measure('silent', async () => 'private-token', 'acquireTokenSilent')
      const report = trace.finish('connected')
      trace.beforeNavigation()
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      render(createElement(Notice, {
        message: 'Startup diagnostics', detail: report,
        showDetailsLabel: 'Show details', hideDetailsLabel: 'Hide details',
        copyDetailsLabel: 'Copy details', copiedLabel: 'Copied', copyFailedLabel: 'Copy failed'
      }))
      fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(report))
      const persisted = [AUTH_STARTUP_BASELINE_KEY, AUTH_STARTUP_PENDING_KEY, AUTH_STARTUP_REPORT_KEY]
        .map((name) => localStorage.getItem(name)).join('')
      const exported = JSON.stringify(await localDocument()) + exportCsv([], [])
      for (const payload of [persisted, report, JSON.stringify(writeText.mock.calls), JSON.stringify(warn.mock.calls), exported]) {
        expect(payload).not.toContain('private')
      }
      expect(JSON.parse(report).cacheEvidence.beforeInitialize).toMatchObject({
        accountReferences: 1, matchingKeyEntries: 1, differentKeyEntries: 0
      })
      expect(localStorage.getItem(key)).toBe(raw)
      expect(localStorage.getItem('msal.2.account.keys')).toBe(JSON.stringify([key]))
      for (const field of ['cacheEvidence', 'lastSuccessfulAuth', 'beforeInitialize', 'afterInitialize']) {
        expect(exported).not.toContain(field)
      }
    } finally {
      localStorage.removeItem(key)
      localStorage.removeItem('msal.2.account.keys')
      document.cookie = 'msal.cache.encryption=; Max-Age=0; path=/'
    }
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
