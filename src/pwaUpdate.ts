import { registerSW } from 'virtual:pwa-register'
import { performServiceWorkerUpdate, singleFlight, UpdateActivationTimeoutError } from './serviceWorkerUpdate'
import { updateStore } from './updateStore'

const CHECK_INTERVAL_MS = 60 * 60 * 1000
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined
let registration: ServiceWorkerRegistration | undefined
let reloadRequested = false

function reportError(error: unknown) {
  updateStore.setError(error instanceof Error ? error.message : String(error))
}

export function initializePwaUpdates() {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: () => updateStore.setAvailable(),
    onRegisteredSW: (_serviceWorkerUrl, nextRegistration) => {
      registration = nextRegistration
      if (!nextRegistration) return
      const check = () => {
        if (navigator.onLine) void nextRegistration.update().catch(reportError)
      }
      check()
      window.setInterval(check, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
    onRegisterError: reportError
  })
}

const runActivation = singleFlight(async () => {
  if (!applyUpdate) {
    updateStore.setError('PWA update registration is not ready')
    return
  }
  updateStore.setApplying()
  try {
    await performServiceWorkerUpdate({
      serviceWorker: navigator.serviceWorker,
      requestActivation: () => applyUpdate!(false),
      registration,
      reload: () => {
        if (reloadRequested) return
        reloadRequested = true
        window.location.reload()
      }
    })
  } catch (error) {
    updateStore.setError(
      error instanceof Error ? error.message : String(error),
      error instanceof UpdateActivationTimeoutError ? 'timeout' : 'failed'
    )
  }
})

export function activatePwaUpdate() {
  return runActivation()
}
