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

export async function withDataOperationLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return await navigator.locks.request('last-time-data-operation', async () => await operation())
  }
  return await dataOperationLock.run(operation)
}
