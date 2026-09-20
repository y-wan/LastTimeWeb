export interface UpdateSnapshot {
  available: boolean
  applying: boolean
  error?: string
  errorKind?: 'failed' | 'network' | 'timeout'
  backgroundCheck?: 'network-failed'
}

export class UpdateStore {
  private snapshot: UpdateSnapshot = { available: false, applying: false }
  private listeners = new Set<(snapshot: UpdateSnapshot) => void>()

  subscribe(listener: (snapshot: UpdateSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setAvailable() {
    this.publish({ available: true, applying: false, error: undefined, errorKind: undefined })
  }

  setApplying() {
    this.publish({ ...this.snapshot, applying: true, error: undefined, errorKind: undefined, backgroundCheck: undefined })
  }

  setError(error: string, errorKind: 'failed' | 'network' | 'timeout' = 'failed') {
    this.publish({ ...this.snapshot, applying: false, error, errorKind })
  }

  beginBackgroundCheck() {
    this.publish({ ...this.snapshot, backgroundCheck: undefined })
  }

  completeBackgroundCheck() {
    this.publish({ ...this.snapshot, backgroundCheck: undefined })
  }

  recordBackgroundNetworkFailure() {
    this.publish({
      ...this.snapshot,
      backgroundCheck: 'network-failed'
    })
  }

  private publish(snapshot: UpdateSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

export const updateStore = new UpdateStore()
