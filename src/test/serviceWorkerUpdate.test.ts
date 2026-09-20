import { describe, expect, it, vi } from 'vitest'
import {
  checkServiceWorkerUpdate,
  classifyServiceWorkerFailure,
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
  it('classifies Xiaomi fetch failures as network but keeps integrity failures actionable', () => {
    expect(classifyServiceWorkerFailure(new Error(
      "Failed to update a ServiceWorker for scope ('https://example/') with script ('https://example/sw.js'): An unknown error occurred when fetching the script."
    ), true)).toBe('network')
    expect(classifyServiceWorkerFailure(new Error('ServiceWorker script has an unsupported MIME type'), true)).toBe('integrity')
    expect(classifyServiceWorkerFailure(new Error('ServiceWorker script evaluation failed'), true)).toBe('integrity')
  })

  it('suppresses cached-app background network failures but not first-install failures', async () => {
    const error = new Error('Failed to fetch the ServiceWorker script')
    const backgroundFailure = vi.fn()
    const actionableFailure = vi.fn()
    const registration = { update: vi.fn().mockRejectedValue(error), waiting: null }

    await checkServiceWorkerUpdate({
      registration,
      online: true,
      hasController: true,
      onBegin: vi.fn(),
      onSuccess: vi.fn(),
      onBackgroundNetworkFailure: backgroundFailure,
      onActionableFailure: actionableFailure
    })
    expect(backgroundFailure).toHaveBeenCalledOnce()
    expect(actionableFailure).not.toHaveBeenCalled()

    await checkServiceWorkerUpdate({
      registration,
      online: true,
      hasController: false,
      onBegin: vi.fn(),
      onSuccess: vi.fn(),
      onBackgroundNetworkFailure: backgroundFailure,
      onActionableFailure: actionableFailure
    })
    expect(actionableFailure).toHaveBeenCalledWith(error)
  })

  it('keeps cached offline startup usable without attempting an update', async () => {
    const registration = { update: vi.fn(), waiting: null }
    const backgroundFailure = vi.fn()
    await checkServiceWorkerUpdate({
      registration,
      online: false,
      hasController: true,
      onBegin: vi.fn(),
      onSuccess: vi.fn(),
      onBackgroundNetworkFailure: backgroundFailure,
      onActionableFailure: vi.fn()
    })
    expect(registration.update).not.toHaveBeenCalled()
    expect(backgroundFailure).toHaveBeenCalledOnce()
  })

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
