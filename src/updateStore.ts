export interface UpdateSnapshot {
  available: boolean
  applying: boolean
  error?: string
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
    this.publish({ available: true, applying: false })
  }

  setApplying() {
    this.publish({ ...this.snapshot, applying: true, error: undefined })
  }

  setError(error: string) {
    this.publish({ ...this.snapshot, applying: false, error })
  }

  private publish(snapshot: UpdateSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

export const updateStore = new UpdateStore()
