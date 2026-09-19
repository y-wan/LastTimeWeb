import { describe, expect, it, vi } from 'vitest'
import {
  performServiceWorkerUpdate,
  singleFlight,
  UpdateActivationTimeoutError,
  type ServiceWorkerContainerLike
} from '../serviceWorkerUpdate'

class FakeServiceWorkerContainer extends EventTarget implements ServiceWorkerContainerLike {
  controller: unknown = { version: 1 }

  changeController() {
    this.controller = { version: 2 }
    this.dispatchEvent(new Event('controllerchange'))
  }
}

describe('installed PWA update activation', () => {
  it('reloads once after controllerchange even if the update promise hangs', async () => {
    const serviceWorker = new FakeServiceWorkerContainer()
    const reload = vi.fn()
    const update = performServiceWorkerUpdate({
      serviceWorker,
      requestActivation: async () => new Promise<void>(() => {}),
      reload,
      timeoutMs: 50
    })

    serviceWorker.changeController()
    await update
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('times out with a recoverable error instead of hanging', async () => {
    const serviceWorker = new FakeServiceWorkerContainer()
    await expect(performServiceWorkerUpdate({
      serviceWorker,
      requestActivation: async () => {},
      registration: { update: async () => {}, waiting: null },
      reload: vi.fn(),
      timeoutMs: 5,
      fallbackTimeoutMs: 5
    })).rejects.toBeInstanceOf(UpdateActivationTimeoutError)
  })

  it('uses the waiting-worker SKIP_WAITING protocol during fallback', async () => {
    const serviceWorker = new FakeServiceWorkerContainer()
    const postMessage = vi.fn(() => serviceWorker.changeController())
    const reload = vi.fn()
    await performServiceWorkerUpdate({
      serviceWorker,
      requestActivation: async () => {},
      registration: { update: async () => {}, waiting: { postMessage } },
      reload,
      timeoutMs: 5,
      fallbackTimeoutMs: 20
    })
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('coalesces duplicate update clicks into one activation', async () => {
    let resolve = () => {}
    const operation = vi.fn(() => new Promise<void>((next) => { resolve = next }))
    const activate = singleFlight(operation)

    const first = activate()
    const second = activate()
    expect(first).toBe(second)
    expect(operation).toHaveBeenCalledTimes(1)
    resolve()
    await first
  })
})
