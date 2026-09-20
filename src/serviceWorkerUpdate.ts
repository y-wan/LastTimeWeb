export interface ServiceWorkerContainerLike {
  controller: unknown
  addEventListener(type: 'controllerchange', listener: () => void): void
  removeEventListener(type: 'controllerchange', listener: () => void): void
}

export interface ServiceWorkerRegistrationLike {
  waiting?: { postMessage(message: unknown): void } | null
  update(): Promise<unknown>
}

export class UpdateActivationTimeoutError extends Error {
  constructor() {
    super('The new version did not activate in time')
    this.name = 'UpdateActivationTimeoutError'
  }
}

export type ServiceWorkerFailureKind = 'network' | 'integrity'

export function classifyServiceWorkerFailure(error: unknown, online = navigator.onLine): ServiceWorkerFailureKind {
  if (!online) return 'network'
  const message = error instanceof Error ? error.message : String(error)
  if (/unsupported mime|syntax|evaluation|security|invalid scope|certificate|ssl/i.test(message)) return 'integrity'
  if (/failed to fetch|networkerror|network error|fetching the script|connection|load failed/i.test(message)) return 'network'
  return 'integrity'
}

export async function checkServiceWorkerUpdate(input: {
  registration: ServiceWorkerRegistrationLike
  online: boolean
  hasController: boolean
  onBegin: () => void
  onSuccess: () => void
  onBackgroundNetworkFailure: () => void
  onActionableFailure: (error: unknown) => void
}) {
  if (!input.online) {
    if (input.hasController) input.onBackgroundNetworkFailure()
    return
  }
  input.onBegin()
  try {
    await input.registration.update()
    input.onSuccess()
  } catch (error) {
    if (input.hasController && classifyServiceWorkerFailure(error, input.online) === 'network') {
      input.onBackgroundNetworkFailure()
    } else {
      input.onActionableFailure(error)
    }
  }
}

const delay = (milliseconds: number) => new Promise<false>((resolve) => {
  window.setTimeout(() => resolve(false), milliseconds)
})

interface UpdateActivationOptions {
  serviceWorker: ServiceWorkerContainerLike
  requestActivation: () => Promise<void>
  registration?: ServiceWorkerRegistrationLike
  reload: () => void
  timeoutMs?: number
  fallbackTimeoutMs?: number
}

export async function performServiceWorkerUpdate({
  serviceWorker,
  requestActivation,
  registration,
  reload,
  timeoutMs = 6_000,
  fallbackTimeoutMs = 2_500
}: UpdateActivationOptions) {
  const initialController = serviceWorker.controller
  let resolveControllerChange = () => {}
  const controllerChanged = new Promise<true>((resolve) => {
    resolveControllerChange = () => resolve(true)
  })
  const onControllerChange = () => resolveControllerChange()
  serviceWorker.addEventListener('controllerchange', onControllerChange)

  try {
    const activationFailure = requestActivation().then(
      () => new Promise<never>(() => {}),
      (error: unknown) => Promise.reject(error)
    )
    let activated = await Promise.race([controllerChanged, activationFailure, delay(timeoutMs)])

    if (!activated) {
      if (registration) {
        await Promise.race([registration.update().catch(() => undefined), delay(fallbackTimeoutMs)])
        if (serviceWorker.controller !== initialController) activated = true
        else registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
      }
      if (!activated) activated = await Promise.race([controllerChanged, delay(fallbackTimeoutMs)])
    }

    if (!activated && serviceWorker.controller === initialController) throw new UpdateActivationTimeoutError()
    reload()
  } finally {
    serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }
}

export function singleFlight<T>(operation: () => Promise<T>) {
  let active: Promise<T> | undefined
  return () => {
    if (!active) active = operation().finally(() => { active = undefined })
    return active
  }
}
