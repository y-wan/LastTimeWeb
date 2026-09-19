import { describe, expect, it } from 'vitest'
import { UpdateStore, type UpdateSnapshot } from '../updateStore'

describe('PWA update prompt state', () => {
  it('publishes availability, applying progress, and explicit errors', () => {
    const store = new UpdateStore()
    const snapshots: UpdateSnapshot[] = []
    const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot))

    store.setAvailable()
    store.setApplying()
    store.setError('activation failed')
    unsubscribe()

    expect(snapshots).toEqual([
      { available: false, applying: false },
      { available: true, applying: false },
      { available: true, applying: true, error: undefined },
      { available: true, applying: false, error: 'activation failed' }
    ])
  })
})
