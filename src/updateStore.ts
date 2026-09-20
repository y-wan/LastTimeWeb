export interface UpdateSnapshot {
  available: boolean
  applying: boolean
  error?: string
  errorKind?: 'failed' | 'timeout'
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
    this.publish({ ...this.snapshot, applying: true, error: undefined, errorKind: undefined })
  }

  setError(error: string, errorKind: 'failed' | 'timeout' = 'failed') {
    this.publish({ ...this.snapshot, applying: false, error, errorKind })
  }

  private publish(snapshot: UpdateSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

export const updateStore = new UpdateStore()
