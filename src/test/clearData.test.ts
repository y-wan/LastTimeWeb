import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canClearAllData, clearAllDataWorkflow, CloudDeletionPendingError } from '../clearData'
import { db, tombstoneAllData } from '../db'

beforeEach(async () => {
  await db.events.clear()
  await db.occurrences.clear()
  await db.settings.clear()
  await db.syncMeta.clear()
  await db.microsoftAuthState.clear()
})

describe('clear all data workflow', () => {
  it('pre-syncs, tombstones, then uploads deletion', async () => {
    const order: string[] = []
    const sync = vi.fn(async () => { order.push(`sync-${order.length}`) })
    const tombstone = vi.fn(async () => { order.push('tombstone') })
    await clearAllDataWorkflow(sync, tombstone)
    expect(order).toEqual(['sync-0', 'tombstone', 'sync-2'])
    expect(sync).toHaveBeenCalledTimes(2)
    expect(tombstone).toHaveBeenCalledOnce()
  })

  it('does not mutate when the pre-sync fails', async () => {
    const tombstone = vi.fn()
    await expect(clearAllDataWorkflow(async () => { throw new Error('download failed') }, tombstone))
      .rejects.toThrow('download failed')
    expect(tombstone).not.toHaveBeenCalled()
  })

  it('reports pending cloud deletion when the post-delete sync fails', async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('upload failed'))
    const tombstone = vi.fn().mockResolvedValue(undefined)
    await expect(clearAllDataWorkflow(sync, tombstone)).rejects.toBeInstanceOf(CloudDeletionPendingError)
    expect(tombstone).toHaveBeenCalledOnce()
  })

  it('requires ready authenticated online non-empty state and prevents double execution', () => {
    expect(canClearAllData({ authReady: true, signedIn: true, online: true, hasData: true, clearing: false })).toBe(true)
    for (const blocked of [
      { authReady: false, signedIn: true, online: true, hasData: true, clearing: false },
      { authReady: true, signedIn: false, online: true, hasData: true, clearing: false },
      { authReady: true, signedIn: true, online: false, hasData: true, clearing: false },
      { authReady: true, signedIn: true, online: true, hasData: false, clearing: false },
      { authReady: true, signedIn: true, online: true, hasData: true, clearing: true }
    ]) expect(canClearAllData(blocked)).toBe(false)
  })

  it('tombstones all active records at one timestamp and preserves settings and sync metadata', async () => {
    await db.events.bulkPut([
      { id: 'event-active', name: 'Active', note: '', icon: 'event', color: '#E86F51', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'event-deleted', name: 'Deleted', note: '', icon: 'event', color: '#E86F51', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' }
    ])
    await db.occurrences.add({ id: 'occ-active', eventId: 'event-active', note: '', occurredAt: '2026-01-03T00:00:00.000Z', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' })
    await db.settings.put({ key: 'settings', locale: 'zh-CN', theme: 'dark', colorTheme: 'sage' })
    await db.syncMeta.put({ key: 'sync:account', accountId: 'account', lastSyncedAt: '2026-01-04T00:00:00.000Z' })
    await db.microsoftAuthState.put({ key: 'microsoft', connectedBefore: true, loginHint: 'person@example.com' })

    const timestamp = '2026-09-19T06:00:00.000Z'
    expect(await tombstoneAllData(timestamp)).toEqual({ events: 1, occurrences: 1, timestamp })
    expect(await db.events.get('event-active')).toMatchObject({ deletedAt: timestamp, updatedAt: timestamp })
    expect(await db.occurrences.get('occ-active')).toMatchObject({ deletedAt: timestamp, updatedAt: timestamp })
    expect(await db.events.get('event-deleted')).toMatchObject({ deletedAt: '2026-01-02T00:00:00.000Z' })
    expect(await db.settings.get('settings')).toMatchObject({ locale: 'zh-CN', theme: 'dark', colorTheme: 'sage' })
    expect(await db.syncMeta.get('sync:account')).toMatchObject({ accountId: 'account', lastSyncedAt: '2026-01-04T00:00:00.000Z' })
    expect(await db.microsoftAuthState.get('microsoft')).toMatchObject({
      connectedBefore: true,
      loginHint: 'person@example.com'
    })
    expect(await tombstoneAllData('2026-09-20T00:00:00.000Z')).toMatchObject({ events: 0, occurrences: 0 })
  })
})
