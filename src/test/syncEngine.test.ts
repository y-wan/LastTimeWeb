import { describe, expect, it } from 'vitest'
import { AsyncOperationLock } from '../operationLock'
import {
  PreconditionFailedError,
  SyncRetryExhaustedError,
  synchronizeWithRetries,
  uploadConditionHeaders,
  type RemoteSnapshot
} from '../syncEngine'
import type { EventRecord, SyncDocument } from '../types'

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

describe('conditional sync retries', () => {
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

  it('queues a local mutation until sync persistence finishes', async () => {
    const lock = new AsyncOperationLock()
    let releaseRemote = () => {}
    const remoteWait = new Promise<void>((resolve) => { releaseRemote = resolve })
    let local = document([event('shared', 'Before')])
    let followUpSyncScheduled = false

    const sync = lock.run(() => synchronizeWithRetries({
      readLocal: async () => structuredClone(local),
      readRemote: async () => { await remoteWait; return undefined },
      persistLocal: async (next) => { local = structuredClone(next) },
      writeRemote: async () => {}
    }))
    const mutation = lock.run(async () => {
      local = document([event('shared', 'After', '2026-01-03T00:00:00.000Z')])
    }).then(() => { followUpSyncScheduled = true })

    releaseRemote()
    await Promise.all([sync, mutation])

    expect(local.events[0].name).toBe('After')
    expect(followUpSyncScheduled).toBe(true)
  })
})
