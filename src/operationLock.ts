export class AsyncOperationLock {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(operation: () => Promise<T>): Promise<T> {
    let release = () => {}
    const turn = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = this.tail
    this.tail = turn
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

const dataOperationLock = new AsyncOperationLock()

export function withDataOperationLock<T>(operation: () => Promise<T>) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('last-time-data-operation', operation)
  }
  return dataOperationLock.run(operation)
}
