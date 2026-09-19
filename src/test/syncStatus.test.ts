import { describe, expect, it } from 'vitest'
import { currentAccountLastSync, syncPresentation } from '../syncStatus'

describe('account-aware sync status', () => {
  it('never reports synced while signed out', () => {
    expect(syncPresentation({
      authReady: true,
      syncState: 'idle',
      lastSuccessfulSyncAt: '2026-09-19T05:00:00.000Z'
    })).toBe('deviceOnly')
  })

  it('requires a successful sync for the active account', () => {
    expect(syncPresentation({ authReady: true, accountId: 'account-a', syncState: 'idle' })).toBe('notSynced')
    expect(syncPresentation({
      authReady: true,
      accountId: 'account-a',
      syncState: 'idle',
      lastSuccessfulSyncAt: '2026-09-19T05:00:00.000Z'
    })).toBe('synced')
  })

  it('prioritizes authenticated offline, progress, and failure states', () => {
    expect(syncPresentation({ authReady: true, accountId: 'a', syncState: 'offline' })).toBe('offline')
    expect(syncPresentation({ authReady: true, accountId: 'a', syncState: 'syncing' })).toBe('syncing')
    expect(syncPresentation({ authReady: true, accountId: 'a', syncState: 'error' })).toBe('error')
  })

  it('does not leak another account’s successful timestamp', () => {
    const meta = { key: 'sync:account-a', accountId: 'account-a', lastSyncedAt: '2026-09-19T05:00:00.000Z' }
    expect(currentAccountLastSync('account-a', meta)).toBe(meta.lastSyncedAt)
    expect(currentAccountLastSync('account-b', meta)).toBeUndefined()
    expect(currentAccountLastSync(undefined, meta)).toBeUndefined()
  })
})
