import { useCallback, useEffect, useRef, useState } from 'react'
import { isSyncConfigured, synchronize, type SuccessfulSync } from './onedrive'
import type { SyncState } from './types'

type SyncRequestOrigin = 'background' | 'user' | 'required'

interface ActiveSyncRequest {
  accountId: string
  announce: boolean
  promise: Promise<SuccessfulSync | undefined>
}

export interface SyncCompletion extends SuccessfulSync {
  sequence: number
}

export function useSync(accountId?: string) {
  const [state, setState] = useState<SyncState>(navigator.onLine ? 'idle' : 'offline')
  const [error, setError] = useState('')
  const [userCompletion, setUserCompletion] = useState<SyncCompletion>()
  const timer = useRef<number | undefined>(undefined)
  const active = useRef<ActiveSyncRequest | undefined>(undefined)
  const accountIdRef = useRef(accountId)
  const observedAccountId = useRef<string | undefined>(undefined)
  const completionSequence = useRef(0)
  accountIdRef.current = accountId

  const execute = useCallback((origin: SyncRequestOrigin, accountOverride?: string) => {
    const requestedAccountId = accountOverride ?? accountIdRef.current
    const propagateError = origin === 'required'
    if (!navigator.onLine) {
      setState('offline')
      const failure = new Error('Offline')
      return propagateError ? Promise.reject(failure) : Promise.resolve(undefined)
    }
    if (!isSyncConfigured() || !requestedAccountId) {
      setState('idle')
      const failure = new Error('Microsoft sign-in is required')
      return propagateError ? Promise.reject(failure) : Promise.resolve(undefined)
    }

    const current = active.current
    if (current && current.accountId === requestedAccountId) {
      if (origin === 'user') current.announce = true
      return propagateError ? current.promise : current.promise.catch(() => undefined)
    }

    setState('syncing')
    setError('')
    const request: ActiveSyncRequest = {
      accountId: requestedAccountId,
      announce: origin === 'user',
      promise: current
        ? current.promise.catch(() => undefined).then(() => synchronize())
        : synchronize()
    }
    active.current = request
    void request.promise.then((result) => {
      if (active.current !== request || accountIdRef.current !== requestedAccountId) return
      setState('idle')
      if (result && request.announce) {
        setUserCompletion({ ...result, sequence: ++completionSequence.current })
      }
    }).catch((cause) => {
      if (active.current !== request || accountIdRef.current !== requestedAccountId) return
      setState(navigator.onLine ? 'error' : 'offline')
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (active.current === request) active.current = undefined
    })
    return propagateError ? request.promise : request.promise.catch(() => undefined)
  }, [])

  const runBackground = useCallback((accountOverride?: string) =>
    execute('background', accountOverride), [execute])
  const runUser = useCallback((accountOverride?: string) =>
    execute('user', accountOverride), [execute])
  const runRequired = useCallback((accountOverride?: string) =>
    execute('required', accountOverride), [execute])

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void runBackground() }, 500)
  }, [runBackground])

  useEffect(() => {
    const changed = observedAccountId.current !== accountId
    observedAccountId.current = accountId
    setError('')
    setUserCompletion(undefined)
    if (!accountId) {
      setState(navigator.onLine ? 'idle' : 'offline')
      return
    }
    if (changed) void runBackground(accountId)
  }, [accountId, runBackground])

  useEffect(() => {
    const online = () => { void runBackground() }
    const offline = () => setState('offline')
    const visible = () => {
      if (document.visibilityState === 'visible') void runBackground()
    }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', visible)
      window.clearTimeout(timer.current)
    }
  }, [runBackground])

  const accountTransitioning = Boolean(accountId && observedAccountId.current !== accountId)
  return {
    state: accountTransitioning ? 'syncing' as const : state,
    error,
    userCompletion,
    runBackground,
    runUser,
    runRequired,
    schedule
  }
}
