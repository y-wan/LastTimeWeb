import { describe, expect, it } from 'vitest'
import { AsyncOperationLock } from '../operationLock'
import {
  documentsHaveSameRecords,
  PreconditionFailedError,
  SyncRetryExhaustedError,
  synchronizeWithRetries,
  uploadConditionHeaders,
  type RemoteSnapshot
} from '../syncEngine'
import { SyncDurationTrace } from '../syncTiming'
import type { EventRecord, OccurrenceRecord, SyncDocument } from '../types'

const event = (id: string, name: string, updatedAt = '2026-01-01T00:00:00.000Z'): EventRecord => ({
  id,
  name,
  note: '',
  icon: 'clock',
  color: '#e66d5b',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt
})

const document = (events: EventRecord[]): SyncDocument => ({
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  events,
  occurrences: []
})

const occurrence = (id: string, eventId: string): OccurrenceRecord => ({
  id,
  eventId,
  occurredAt: '2026-01-01T00:00:00.000Z',
  note: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

describe('conditional sync retries', () => {
  it('skips a mocked 30-second Graph upload when local and remote records are already identical', async () => {
    const events = Array.from({ length: 14 }, (_, index) => event(`event-${index}`, `Event ${index}`))
    const shared = {
      ...document(events),
      occurrences: Array.from(
        { length: 908 },
        (_, index) => occurrence(`occurrence-${index}`, events[index % events.length].id)
      )
    }
    let nowMs = 0
    let writes = 0
    const trace = new SyncDurationTrace(() => nowMs)
    const result = await synchronizeWithRetries({
      readLocal: () => trace.measure('localRead', async () => {
        nowMs += 2
        return { ...shared, updatedAt: '2026-01-03T00:00:00.000Z' }
      }),
      readRemote: () => trace.measure('remoteContent', async () => {
        nowMs += 5
        return {
          identity: { id: 'drive-item', eTag: '"etag-a"' },
          document: { ...shared, updatedAt: '2026-01-02T00:00:00.000Z' }
        }
      }),
      persistLocal: () => trace.measure('localPersist', async () => { nowMs += 1 }),
      writeRemote: () => trace.measure('remoteWrite', async () => {
        writes += 1
        nowMs += 30_000
      }),
      now: () => '2026-01-04T00:00:00.000Z'
    })

    expect(writes).toBe(0)
    expect(result.uploaded).toBe(false)
    expect(result.completedAt).toBe('2026-01-04T00:00:00.000Z')
    expect(trace.summary({
      outcome: 'success',
      attempts: result.attempts,
      uploaded: result.uploaded,
      documentBytes: 0
    })).toMatchObject({
      totalMs: 8,
      stages: { remoteContent: 5, localRead: 2, localPersist: 1 },
      uploaded: false
    })
  })

  it('compares record content independently of document timestamps and array order', () => {
    const first = event('a', 'A')
    const second = event('b', 'B')
    expect(documentsHaveSameRecords(
      { ...document([first, second]), updatedAt: '2026-01-01T00:00:00.000Z' },
      { ...document([second, first]), updatedAt: '2026-02-01T00:00:00.000Z' }
    )).toBe(true)
    expect(documentsHaveSameRecords(document([first]), document([event('a', 'Changed')]))).toBe(false)
  })

  it('uses ETag preconditions and remerges after a stale 412', async () => {
    const remotes: RemoteSnapshot[] = [
      { identity: { id: 'drive-item', eTag: '"etag-a"' }, document: document([event('remote-a', 'A')]) },
      { identity: { id: 'drive-item', eTag: '"etag-b"' }, document: document([event('remote-b', 'B')]) }
    ]
    const writes: Array<{ document: SyncDocument; eTag?: string }> = []
    let reads = 0
    let localReads = 0

    const result = await synchronizeWithRetries({
      readLocal: async () => document([event(localReads++ === 0 ? 'local-a' : 'local-b', 'Local')]),
      readRemote: async () => remotes[reads++],
      persistLocal: async () => {},
      writeRemote: async (next, expected) => {
        writes.push({ document: next, eTag: expected?.eTag })
        if (writes.length === 1) throw new PreconditionFailedError()
      },
      now: () => '2026-01-02T00:00:00.000Z'
    })

    expect(result.attempts).toBe(2)
    expect(result.uploaded).toBe(true)
    expect(writes.map((write) => write.eTag)).toEqual(['"etag-a"', '"etag-b"'])
    expect(writes[1].document.events.map((item) => item.id)).toEqual(['local-b', 'remote-b'])
    expect(uploadConditionHeaders(remotes[1].identity)).toEqual({ 'If-Match': '"etag-b"' })
    expect(uploadConditionHeaders(undefined)).toEqual({ 'If-None-Match': '*' })
  })

  it('fails explicitly after bounded precondition retries', async () => {
    let attempts = 0
    await expect(synchronizeWithRetries({
      readLocal: async () => document([event('local', 'Local')]),
      readRemote: async () => ({
        identity: { id: 'drive-item', eTag: `"etag-${++attempts}"` },
        document: document([])
      }),
      persistLocal: async () => {},
      writeRemote: async () => { throw new PreconditionFailedError() },
      maxAttempts: 3
    })).rejects.toEqual(expect.objectContaining({
      name: SyncRetryExhaustedError.name,
      message: expect.stringContaining('3 times')
    }))
    expect(attempts).toBe(3)
  })

  it('releases the local data lock before a slow remote upload finishes', async () => {
    const lock = new AsyncOperationLock()
    let releaseUpload = () => {}
    let uploadStarted = () => {}
    const uploadWait = new Promise<void>((resolve) => { releaseUpload = resolve })
    const uploadStart = new Promise<void>((resolve) => { uploadStarted = resolve })
    let local = document([event('shared', 'Before')])

    const sync = synchronizeWithRetries({
      readLocal: async () => structuredClone(local),
      readRemote: async () => undefined,
      persistLocal: async (next) => { local = structuredClone(next) },
      writeRemote: async () => {
        uploadStarted()
        await uploadWait
      },
      withLocalLock: (operation) => lock.run(operation)
    })
    await uploadStart

    await lock.run(async () => {
      local = document([event('shared', 'After', '2026-01-03T00:00:00.000Z')])
    })

    expect(local.events[0].name).toBe('After')

    releaseUpload()
    await sync
  })

  it('keeps the local merge and persistence atomic against mutations', async () => {
    const lock = new AsyncOperationLock()
    let releasePersist = () => {}
    let persistStarted = () => {}
    const persistWait = new Promise<void>((resolve) => { releasePersist = resolve })
    const persistStart = new Promise<void>((resolve) => { persistStarted = resolve })
    let local = document([event('shared', 'Before')])

    const sync = synchronizeWithRetries({
      readLocal: async () => structuredClone(local),
      readRemote: async () => undefined,
      persistLocal: async (next) => {
        persistStarted()
        await persistWait
        local = structuredClone(next)
      },
      writeRemote: async () => {},
      withLocalLock: (operation) => lock.run(operation)
    })
    await persistStart

    let mutationCompleted = false
    const mutation = lock.run(async () => {
      local = document([event('shared', 'After', '2026-01-03T00:00:00.000Z')])
      mutationCompleted = true
    })
    await Promise.resolve()
    expect(mutationCompleted).toBe(false)

    releasePersist()
    await Promise.all([sync, mutation])
    expect(local.events[0].name).toBe('After')
  })
})
