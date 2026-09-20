import { registerSW } from 'virtual:pwa-register'
import {
  checkServiceWorkerUpdate,
  classifyServiceWorkerFailure,
  performServiceWorkerUpdate,
  singleFlight,
  UpdateActivationTimeoutError
} from './serviceWorkerUpdate'
import { updateStore } from './updateStore'

const CHECK_INTERVAL_MS = 60 * 60 * 1000
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined
let registration: ServiceWorkerRegistration | undefined
let reloadRequested = false

function reportActionableError(error: unknown) {
  updateStore.setError(
    error instanceof Error ? error.message : String(error),
    classifyServiceWorkerFailure(error, navigator.onLine) === 'network' ? 'network' : 'failed'
  )
}

export function initializePwaUpdates() {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: () => updateStore.setAvailable(),
    onRegisteredSW: (_serviceWorkerUrl, nextRegistration) => {
      registration = nextRegistration
      if (!nextRegistration) return
      const check = () => void checkServiceWorkerUpdate({
        registration: nextRegistration,
        online: navigator.onLine,
        hasController: Boolean(navigator.serviceWorker.controller),
        onBegin: () => updateStore.beginBackgroundCheck(),
        onSuccess: () => updateStore.completeBackgroundCheck(),
        onBackgroundNetworkFailure: () => updateStore.recordBackgroundNetworkFailure(),
        onActionableFailure: reportActionableError
      })
      check()
      window.setInterval(check, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('online', check)
    },
    onRegisterError: (error) => {
      if (navigator.serviceWorker.controller &&
          classifyServiceWorkerFailure(error, navigator.onLine) === 'network') {
        updateStore.recordBackgroundNetworkFailure()
      } else {
        reportActionableError(error)
      }
    }
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
      error instanceof UpdateActivationTimeoutError
        ? 'timeout'
        : classifyServiceWorkerFailure(error, navigator.onLine) === 'network'
          ? 'network'
          : 'failed'
    )
  }
})

export function activatePwaUpdate() {
  return runActivation()
}
