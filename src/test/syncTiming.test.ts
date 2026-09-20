import { describe, expect, it } from 'vitest'
import { SyncDurationTrace } from '../syncTiming'

describe('sync duration tracing', () => {
  it('reports precise stage totals without sync content or account identifiers', async () => {
    let now = 100
    const trace = new SyncDurationTrace(() => now)

    await trace.measure('token', async () => { now += 7 })
    const lockRequestedAt = trace.timestamp()
    now += 11
    trace.addSince('lockWait', lockRequestedAt)
    await trace.measure('remoteMetadata', async () => { now += 13 })
    await trace.measure('remoteContent', async () => { now += 17 })
    await trace.measure('remoteWrite', async () => { now += 30_000 })

    const summary = trace.summary({
      outcome: 'success',
      attempts: 1,
      uploaded: true,
      documentBytes: 123_456
    })
    expect(summary).toEqual({
      totalMs: 30_048,
      stages: {
        token: 7,
        lockWait: 11,
        remoteMetadata: 13,
        remoteContent: 17,
        remoteWrite: 30_000
      },
      outcome: 'success',
      attempts: 1,
      uploaded: true,
      documentBytes: 123_456
    })
    expect(JSON.stringify(summary)).not.toContain('private-person@example.com')
  })
})
