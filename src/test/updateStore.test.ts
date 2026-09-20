import { describe, expect, it } from 'vitest'
import { UpdateStore, type UpdateSnapshot } from '../updateStore'

describe('PWA update prompt state', () => {
  it('publishes availability, applying progress, and explicit errors', () => {
    const store = new UpdateStore()
    const snapshots: UpdateSnapshot[] = []
    const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot))

    store.setAvailable()
    store.setApplying()
    store.setError('activation failed', 'timeout')
    store.setAvailable()
    store.setError('activation failed again')
    store.setApplying()
    store.setAvailable()
    store.recordBackgroundNetworkFailure()
    store.beginBackgroundCheck()
    store.completeBackgroundCheck()
    store.setError('persistent activation failure', 'failed')
    store.beginBackgroundCheck()
    store.recordBackgroundNetworkFailure()
    unsubscribe()

    expect(snapshots).toEqual([
      { available: false, applying: false },
      { available: true, applying: false },
      { available: true, applying: true, error: undefined, errorKind: undefined },
      { available: true, applying: false, error: 'activation failed', errorKind: 'timeout' },
      { available: true, applying: false, error: undefined, errorKind: undefined },
      { available: true, applying: false, error: 'activation failed again', errorKind: 'failed' },
      { available: true, applying: true, error: undefined, errorKind: undefined, backgroundCheck: undefined },
      { available: true, applying: false, error: undefined, errorKind: undefined },
      { available: true, applying: false, error: undefined, errorKind: undefined, backgroundCheck: 'network-failed' },
      { available: true, applying: false, error: undefined, errorKind: undefined, backgroundCheck: undefined },
      { available: true, applying: false, error: undefined, errorKind: undefined, backgroundCheck: undefined },
      {
        available: true,
        applying: false,
        error: 'persistent activation failure',
        errorKind: 'failed',
        backgroundCheck: undefined
      },
      {
        available: true,
        applying: false,
        error: 'persistent activation failure',
        errorKind: 'failed',
        backgroundCheck: undefined
      },
      {
        available: true,
        applying: false,
        error: 'persistent activation failure',
        errorKind: 'failed',
        backgroundCheck: 'network-failed'
      }
    ])
  })
})
