import { registerSW } from 'virtual:pwa-register'
import { updateStore } from './updateStore'

const CHECK_INTERVAL_MS = 60 * 60 * 1000
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined

function reportError(error: unknown) {
  updateStore.setError(error instanceof Error ? error.message : String(error))
}

export function initializePwaUpdates() {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: () => updateStore.setAvailable(),
    onRegisteredSW: (_serviceWorkerUrl, registration) => {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) void registration.update().catch(reportError)
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

export async function activatePwaUpdate() {
  if (!applyUpdate) {
    updateStore.setError('PWA update registration is not ready')
    return
  }
  updateStore.setApplying()
  try {
    await applyUpdate(true)
  } catch (error) {
    reportError(error)
  }
}
