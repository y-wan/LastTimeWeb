import { InteractionRequiredAuthError, type AccountInfo, type PublicClientApplication, type RedirectRequest } from '@azure/msal-browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSnapshot } from '../authSession'

const msal = vi.hoisted(() => ({
  initialize: vi.fn(),
  handleRedirectPromise: vi.fn(),
  getActiveAccount: vi.fn(),
  getAllAccounts: vi.fn(),
  setActiveAccount: vi.fn(),
  ssoSilent: vi.fn(),
  loginPopup: vi.fn(),
  loginRedirect: vi.fn(),
  logoutPopup: vi.fn(),
  acquireTokenSilent: vi.fn(),
  acquireTokenPopup: vi.fn(),
  addPerformanceCallback: vi.fn<PublicClientApplication['addPerformanceCallback']>(),
  removePerformanceCallback: vi.fn<PublicClientApplication['removePerformanceCallback']>()
}))

vi.mock('@azure/msal-browser', async (importOriginal) => ({
  ...await importOriginal<typeof import('@azure/msal-browser')>(),
  PublicClientApplication: class {
    constructor() {
      return msal
    }
  }
}))

function account(): AccountInfo {
  return {
    homeAccountId: 'home-account',
    environment: 'login.microsoftonline.com',
    tenantId: 'tenant',
    username: 'person@example.com',
    localAccountId: 'local-account'
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_MS_CLIENT_ID', 'test-client-id')
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.values(msal).forEach((method) => method.mockReset())
  let activeAccount: AccountInfo | null = null
  msal.initialize.mockResolvedValue(undefined)
  msal.handleRedirectPromise.mockResolvedValue(null)
  msal.getActiveAccount.mockImplementation(() => activeAccount)
  msal.getAllAccounts.mockReturnValue([])
  msal.setActiveAccount.mockImplementation((account: AccountInfo | null) => {
    activeAccount = account
  })
  msal.ssoSilent.mockRejectedValue(new InteractionRequiredAuthError(
    'interaction_required', 'Session information is not sufficient for single-sign-on.'
  ))
  msal.acquireTokenSilent.mockResolvedValue({ accessToken: 'test-token' })
  msal.loginRedirect.mockResolvedValue(undefined)
  msal.addPerformanceCallback.mockReturnValue('startup-callback')
  msal.removePerformanceCallback.mockReturnValue(true)
  localStorage.clear()
  document.cookie = 'msal.cache.encryption=; Max-Age=0; path=/'
  const { db } = await import('../db')
  await db.microsoftAuthState.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'standalone')
  Reflect.deleteProperty(navigator, 'userAgent')
  Reflect.deleteProperty(document, 'visibilityState')
})

async function observeAuth() {
  const onedrive = await import('../onedrive')
  const snapshots: AuthSnapshot[] = []
  onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot))
  return { onedrive, snapshots }
}

describe('installed iPhone Microsoft authorization', () => {
  it('redirects a reconnect and restores the account on the callback load', async () => {
    const { claimMicrosoftColdStartRecovery, rememberMicrosoftConnection } = await import('../db')
    await rememberMicrosoftConnection('person@example.com')
    await claimMicrosoftColdStartRecovery('person@example.com')
    const firstLoad = await import('../onedrive')
    const snapshots: string[] = []
    firstLoad.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('reconnect-required'))

    expect(await firstLoad.signIn()).toBeUndefined()
    expect(msal.loginRedirect).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite.AppFolder'],
      loginHint: 'person@example.com'
    })
    expect(msal.loginPopup).not.toHaveBeenCalled()

    vi.resetModules()
    const restored = account()
    msal.handleRedirectPromise.mockResolvedValue({ account: restored })
    const callbackLoad = await import('../onedrive')
    const callbackSnapshots: string[] = []
    callbackLoad.subscribeAuth((snapshot) => callbackSnapshots.push(snapshot.status))
    await vi.waitFor(() => expect(callbackSnapshots).toContain('connected'))
    expect(await callbackLoad.currentAccount()).toEqual(restored)
  })

  it('stops background sync at reconnect when the cached account needs interaction', async () => {
    const cached = account()
    msal.getAllAccounts.mockReturnValue([cached])
    const onedrive = await import('../onedrive')
    const snapshots: string[] = []
    onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('connected'))

    msal.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
    await expect(onedrive.synchronize()).rejects.toBeInstanceOf(InteractionRequiredAuthError)
    expect(snapshots.at(-1)).toBe('reconnect-required')
    expect(await onedrive.currentAccount()).toBeUndefined()
    expect(msal.acquireTokenPopup).not.toHaveBeenCalled()
    expect(msal.loginRedirect).not.toHaveBeenCalled()
  })

  it('restores silently after a network failure without requesting sign-in', async () => {
    const { rememberMicrosoftConnection } = await import('../db')
    await rememberMicrosoftConnection('person@example.com')
    msal.ssoSilent.mockRejectedValue(new Error('network failed'))
    const onedrive = await import('../onedrive')
    const snapshots: string[] = []
    onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('restore-failed'))

    msal.ssoSilent.mockResolvedValue({ account: account() })
    await expect(onedrive.retryAuthRestore()).resolves.toBe(true)
    expect(snapshots.at(-1)).toBe('connected')
    expect(await onedrive.currentAccount()).toEqual(account())
    expect(msal.ssoSilent).toHaveBeenCalledTimes(2)
    expect(msal.loginRedirect).not.toHaveBeenCalled()
    expect(msal.loginPopup).not.toHaveBeenCalled()
  })

  it('keeps repeated failures retryable and coalesces simultaneous recovery triggers', async () => {
    const { rememberMicrosoftConnection } = await import('../db')
    await rememberMicrosoftConnection('person@example.com')
    msal.ssoSilent.mockRejectedValue(new Error('network failed'))
    const onedrive = await import('../onedrive')
    const snapshots: string[] = []
    onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('restore-failed'))

    await Promise.all([onedrive.retryAuthRestore(), onedrive.retryAuthRestore()])
    expect(msal.ssoSilent).toHaveBeenCalledTimes(2)
    expect(snapshots.at(-1)).toBe('restore-failed')
    expect(msal.loginRedirect).not.toHaveBeenCalled()
    expect(msal.loginPopup).not.toHaveBeenCalled()
  })

  it('does not retry while offline and restores when connectivity returns', async () => {
    const { rememberMicrosoftConnection } = await import('../db')
    await rememberMicrosoftConnection('person@example.com')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const onedrive = await import('../onedrive')
    const snapshots: string[] = []
    onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('reconnect-required'))

    await expect(onedrive.retryAuthRestore()).resolves.toBe(false)
    expect(msal.ssoSilent).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    msal.ssoSilent.mockResolvedValue({ account: account() })
    await expect(onedrive.retryAuthRestore()).resolves.toBe(true)
    expect(msal.ssoSilent).toHaveBeenCalledOnce()
  })

  it('does not automatically retry a genuine authorization requirement after recovery was consumed', async () => {
    const { claimMicrosoftColdStartRecovery, rememberMicrosoftConnection } = await import('../db')
    await rememberMicrosoftConnection('person@example.com')
    await claimMicrosoftColdStartRecovery('person@example.com')
    const onedrive = await import('../onedrive')
    const snapshots: string[] = []
    onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('reconnect-required'))

    await expect(onedrive.retryAuthRestore()).resolves.toBe(false)
    expect(msal.ssoSilent).toHaveBeenCalledOnce()
    expect(msal.loginRedirect).not.toHaveBeenCalled()
    expect(msal.loginPopup).not.toHaveBeenCalled()
  })

  it('retains the account hint when explicitly reconnecting after restoration fails', async () => {
    const { rememberMicrosoftConnection } = await import('../db')
    await rememberMicrosoftConnection('person@example.com')
    msal.ssoSilent.mockRejectedValue(new Error('network failed'))
    const onedrive = await import('../onedrive')
    const snapshots: string[] = []
    onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('restore-failed'))

    await onedrive.signIn()
    expect(msal.loginRedirect).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite.AppFolder'],
      loginHint: 'person@example.com'
    })
  })

  describe('iPhone startup-only automatic recovery', () => {
    it.each(['sso', 'cached'])('performs one guarded top-level recovery for the %s startup path', async (path) => {
      const { readMicrosoftAuthState, rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      if (path === 'cached') {
        msal.getAllAccounts.mockReturnValue([account()])
        msal.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
      }
      const { onedrive, snapshots } = await observeAuth()
      expect(await onedrive.currentAccount()).toBeUndefined()
      expect(snapshots.at(-1)).toMatchObject({ ready: false, status: 'restoring' })
      expect(snapshots.some((snapshot) => snapshot.status === 'connected')).toBe(false)
      expect(msal.loginRedirect).toHaveBeenCalledExactlyOnceWith({
        scopes: ['Files.ReadWrite.AppFolder'],
        prompt: 'none',
        loginHint: 'person@example.com',
        ...(path === 'cached' ? { account: account() } : {}),
        state: 'last-time-cold-start-recovery',
        onRedirectNavigate: expect.any(Function)
      })
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
      expect(msal.loginPopup).not.toHaveBeenCalled()
      expect(msal.acquireTokenPopup).not.toHaveBeenCalled()
    })

    it('coalesces simultaneous subscribers into one authorization attempt', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      const { onedrive } = await observeAuth()
      onedrive.subscribeAuth(() => {})
      onedrive.subscribeAuth(() => {})
      await onedrive.currentAccount()
      expect(msal.ssoSilent).toHaveBeenCalledOnce()
      expect(msal.loginRedirect).toHaveBeenCalledOnce()
    })

    it('does not redirect again after abandonment, callback failure or repeated cold loads', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      const initial = await observeAuth()
      await initial.onedrive.currentAccount()
      expect(msal.loginRedirect).toHaveBeenCalledOnce()

      vi.resetModules()
      msal.handleRedirectPromise.mockRejectedValueOnce(new Error('interaction_required: Microsoft callback denied'))
      const callback = await observeAuth()
      await callback.onedrive.currentAccount()
      expect(callback.snapshots.at(-1)).toMatchObject({
        status: 'reconnect-required', error: 'interaction_required: Microsoft callback denied'
      })

      for (let load = 0; load < 2; load++) {
        vi.resetModules()
        const restarted = await observeAuth()
        await restarted.onedrive.currentAccount()
        expect(restarted.snapshots.at(-1)).toMatchObject({ status: 'reconnect-required' })
        expect(JSON.parse(restarted.snapshots.at(-1)!.startupDiagnostics!).automaticRecoverySkipReason)
          .toBe('previous-attempt')
      }
      expect(msal.loginRedirect).toHaveBeenCalledOnce()
    })

    it('clears the guard after a verified same-account callback and permits a later fresh recovery', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      const initial = await observeAuth()
      await initial.onedrive.currentAccount()

      vi.resetModules()
      msal.handleRedirectPromise.mockResolvedValueOnce({
        account: account(), state: 'last-time-cold-start-recovery'
      })
      const callback = await observeAuth()
      expect(await callback.onedrive.currentAccount()).toEqual(account())
      const { readMicrosoftAuthState } = await import('../db')
      expect(await readMicrosoftAuthState()).not.toHaveProperty('coldStartRecovery')
      expect(msal.acquireTokenSilent).toHaveBeenCalledOnce()

      vi.resetModules()
      msal.setActiveAccount(null)
      const fresh = await observeAuth()
      await fresh.onedrive.currentAccount()
      expect(msal.loginRedirect).toHaveBeenCalledTimes(2)
    })

    it('does not loop when an automatic callback still cannot acquire a token', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      const initial = await observeAuth()
      await initial.onedrive.currentAccount()

      vi.resetModules()
      msal.handleRedirectPromise.mockResolvedValueOnce({
        account: account(), state: 'last-time-cold-start-recovery'
      })
      msal.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
      const callback = await observeAuth()
      expect(await callback.onedrive.currentAccount()).toBeUndefined()
      expect(callback.snapshots.at(-1)).toMatchObject({
        status: 'reconnect-required', error: expect.stringContaining('interaction_required')
      })
      expect(msal.loginRedirect).toHaveBeenCalledOnce()
      const { readMicrosoftAuthState } = await import('../db')
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
    })

    it('refuses a different callback account without overwriting the hint or syncing it', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      const initial = await observeAuth()
      await initial.onedrive.currentAccount()

      vi.resetModules()
      const unexpected = { ...account(), username: 'other@example.com', homeAccountId: 'other-account' }
      msal.handleRedirectPromise.mockResolvedValueOnce({
        account: unexpected, state: 'last-time-cold-start-recovery'
      })
      msal.getAllAccounts.mockReturnValue([unexpected])
      const callback = await observeAuth()
      expect(await callback.onedrive.currentAccount()).toBeUndefined()
      expect(callback.snapshots.at(-1)).toMatchObject({
        status: 'reconnect-required', error: expect.stringContaining('different account')
      })
      const { readMicrosoftAuthState } = await import('../db')
      expect(await readMicrosoftAuthState()).toMatchObject({ loginHint: 'person@example.com', coldStartRecovery: {} })
      expect(msal.acquireTokenSilent).not.toHaveBeenCalled()

      vi.resetModules()
      const restarted = await observeAuth()
      expect(await restarted.onedrive.currentAccount()).toBeUndefined()
      expect(msal.loginRedirect).toHaveBeenCalledOnce()
    })

    it.each([
      ['pointerdown', 'user-interaction'],
      ['keydown', 'user-interaction'],
      ['input', 'user-interaction'],
      ['click', 'user-interaction'],
      ['visibilitychange', 'visibility-hidden'],
      ['visibility-visible', 'visibility-visible'],
      ['pagehide', 'page-hidden'],
      ['online', 'connectivity-changed'],
      ['offline', 'connectivity-changed']
    ])(
      'cancels startup redirect permanently after %s while SSO is pending', async (event, reason) => {
        const { readMicrosoftAuthState, rememberMicrosoftConnection } = await import('../db')
        await rememberMicrosoftConnection('person@example.com')
        let rejectSilent!: (error: unknown) => void
        msal.ssoSilent.mockImplementation(() => new Promise((_resolve, reject) => { rejectSilent = reject }))
        const { onedrive, snapshots } = await observeAuth()
        await vi.waitFor(() => expect(msal.ssoSilent).toHaveBeenCalledOnce())

        if (event === 'visibilitychange') {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
          document.dispatchEvent(new Event(event))
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
          document.dispatchEvent(new Event(event))
        } else if (event === 'visibility-visible') {
          document.dispatchEvent(new Event('visibilitychange'))
        } else if (['pagehide', 'online', 'offline'].includes(event)) {
          window.dispatchEvent(new Event(event))
        } else {
          document.dispatchEvent(new Event(event, { bubbles: true }))
        }
        rejectSilent(new InteractionRequiredAuthError('interaction_required'))
        expect(await onedrive.currentAccount()).toBeUndefined()
        expect(snapshots.at(-1)).toMatchObject({ status: 'reconnect-required' })
        expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
          automaticRedirect: 'not-attempted', automaticRecoverySkipReason: reason
        })
        expect(msal.loginRedirect).not.toHaveBeenCalled()
        expect(await readMicrosoftAuthState()).not.toHaveProperty('coldStartRecovery')
      }
    )

    it('also cancels recovery while the cached token check is pending', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      msal.getAllAccounts.mockReturnValue([account()])
      let rejectSilent!: (error: unknown) => void
      msal.acquireTokenSilent.mockImplementation(() => new Promise((_resolve, reject) => { rejectSilent = reject }))
      const { onedrive } = await observeAuth()
      await vi.waitFor(() => expect(msal.acquireTokenSilent).toHaveBeenCalledOnce())
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      rejectSilent(new InteractionRequiredAuthError('interaction_required'))
      expect(await onedrive.currentAccount()).toBeUndefined()
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it.each(['offline', 'hidden'])('observes the current %s gate even without a cancellation event', async (state) => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      let rejectSilent!: (error: unknown) => void
      msal.ssoSilent.mockImplementation(() => new Promise((_resolve, reject) => { rejectSilent = reject }))
      const { onedrive, snapshots } = await observeAuth()
      await vi.waitFor(() => expect(msal.ssoSilent).toHaveBeenCalledOnce())
      if (state === 'offline') {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      } else {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      }
      rejectSilent(new InteractionRequiredAuthError('interaction_required'))
      expect(await onedrive.currentAccount()).toBeUndefined()
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!).automaticRecoverySkipReason)
        .toBe(state === 'offline' ? 'currently-offline' : 'currently-hidden')
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('cancels the final navigation if editing starts while MSAL prepares the redirect', async () => {
      const { readMicrosoftAuthState, rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      let finishRedirect!: () => void
      msal.loginRedirect.mockImplementation((request: RedirectRequest) => new Promise<void>((resolve, reject) => {
        finishRedirect = () => {
          try {
            expect(request.onRedirectNavigate?.('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true)
            resolve()
          } catch (error) {
            reject(error)
          }
        }
      }))
      const { onedrive, snapshots } = await observeAuth()
      await vi.waitFor(() => expect(msal.loginRedirect).toHaveBeenCalledOnce())
      document.dispatchEvent(new Event('input', { bubbles: true }))
      finishRedirect()
      expect(await onedrive.currentAccount()).toBeUndefined()
      expect(snapshots.at(-1)).toMatchObject({
        ready: true,
        status: 'reconnect-required',
        error: expect.stringMatching(/interaction_required[\s\S]*recovery was cancelled/)
      })
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!).automaticRecoverySkipReason).toBe('user-interaction')
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')

      msal.loginRedirect.mockResolvedValueOnce(undefined)
      await onedrive.signIn()
      expect(msal.loginRedirect).toHaveBeenCalledTimes(2)
      expect(await readMicrosoftAuthState()).not.toHaveProperty('coldStartRecovery')
    })

    it('does not redirect when an initially hidden app becomes visible', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      const { onedrive, snapshots } = await observeAuth()
      await onedrive.currentAccount()
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!).automaticRecoverySkipReason).toBe('initially-hidden')
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      await onedrive.retryAuthRestore()
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('keeps foreground/network restoration retries ineligible for automatic redirect', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      msal.ssoSilent.mockRejectedValueOnce(new Error('network failed'))
      const { onedrive, snapshots } = await observeAuth()
      await onedrive.currentAccount()
      expect(snapshots.at(-1)).toMatchObject({ status: 'restore-failed' })

      await expect(onedrive.retryAuthRestore()).resolves.toBe(false)
      expect(snapshots.at(-1)).toMatchObject({ status: 'reconnect-required' })
      expect(msal.ssoSilent).toHaveBeenCalledTimes(2)
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('does not acquire startup redirect permission from an ordinary account request', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      const onedrive = await import('../onedrive')
      await onedrive.currentAccount()
      const snapshots: AuthSnapshot[] = []
      onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot))
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!).automaticRecoverySkipReason).toBe('startup-not-requested')
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('records a missing retained login hint without requesting navigation', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection()
      const { onedrive, snapshots } = await observeAuth()
      expect(await onedrive.currentAccount()).toBeUndefined()
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
        outcome: 'reconnect-required', automaticRedirect: 'not-attempted',
        automaticRecoverySkipReason: 'missing-login-hint'
      })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('records a denied guard claim without requesting navigation', async () => {
      const store = await import('../db')
      await store.rememberMicrosoftConnection('person@example.com')
      vi.spyOn(store, 'claimMicrosoftColdStartRecovery').mockResolvedValue(false)
      const { onedrive, snapshots } = await observeAuth()
      expect(await onedrive.currentAccount()).toBeUndefined()
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
        outcome: 'reconnect-required', automaticRedirect: 'not-attempted',
        automaticRecoverySkipReason: 'guard-claim-denied'
      })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it.each([
      ['iPhone Safari', 'iPhone', false],
      ['iPad PWA', 'iPad', true],
      ['desktop', 'Windows NT 10.0', false],
      ['Android', 'Android', true]
    ])('does not automatically redirect in %s', async (_platform, userAgent, standalone) => {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone })
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      const { onedrive, snapshots } = await observeAuth()
      await onedrive.currentAccount()
      expect(snapshots.at(-1)).toMatchObject({ status: 'reconnect-required' })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
      expect(msal.acquireTokenSilent).not.toHaveBeenCalled()
      expect(msal.addPerformanceCallback).not.toHaveBeenCalled()
      expect(snapshots.at(-1)?.startupDiagnostics).toBeUndefined()
    })

    it('preserves desktop interactive token acquisition after startup', async () => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
      const cached = account()
      msal.getAllAccounts.mockReturnValue([cached])
      const { onedrive } = await observeAuth()
      expect(await onedrive.currentAccount()).toEqual(cached)
      expect(msal.acquireTokenSilent).not.toHaveBeenCalled()
      const failure = new InteractionRequiredAuthError('interaction_required')
      msal.acquireTokenSilent.mockRejectedValue(failure)
      msal.acquireTokenPopup.mockRejectedValue(new Error('popup cancelled'))
      await expect(onedrive.synchronize()).rejects.toThrow('popup cancelled')
      expect(msal.acquireTokenPopup).toHaveBeenCalledWith({ account: cached, scopes: ['Files.ReadWrite.AppFolder'] })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('surfaces durable guard write failure without starting navigation', async () => {
      const store = await import('../db')
      await store.rememberMicrosoftConnection('person@example.com')
      vi.spyOn(store, 'claimMicrosoftColdStartRecovery').mockRejectedValue(new Error('guard unavailable'))
      const { onedrive, snapshots } = await observeAuth()
      expect(await onedrive.currentAccount()).toBeUndefined()
      expect(snapshots.at(-1)).toMatchObject({
        status: 'reconnect-required', error: expect.stringMatching(/interaction_required[\s\S]*guard unavailable/)
      })
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!).automaticRecoverySkipReason).toBe('recovery-start-failed')
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })
  })

  it('does not retry first-use or explicitly signed-out accounts', async () => {
    const onedrive = await import('../onedrive')
    const snapshots: string[] = []
    onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('disconnected'))

    await expect(onedrive.retryAuthRestore()).resolves.toBe(false)
    await onedrive.signOut()
    await expect(onedrive.retryAuthRestore()).resolves.toBe(false)
    expect(msal.ssoSilent).not.toHaveBeenCalled()
    expect(msal.loginRedirect).not.toHaveBeenCalled()
  })

  describe('startup diagnostics integration', () => {
    it('refreshes the silent-auth baseline after foreground restoration and token success even if sync later fails', async () => {
      const { AUTH_STARTUP_BASELINE_KEY } = await import('../authCacheEvidence')
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      msal.ssoSilent.mockRejectedValueOnce(new Error('network failed'))
      const { onedrive } = await observeAuth()
      await onedrive.currentAccount()
      expect(localStorage.getItem(AUTH_STARTUP_BASELINE_KEY)).toBeNull()
      msal.ssoSilent.mockResolvedValueOnce({ account: account() })
      await expect(onedrive.retryAuthRestore()).resolves.toBe(true)
      expect(JSON.parse(localStorage.getItem(AUTH_STARTUP_BASELINE_KEY)!)).toMatchObject({
        schema: 1, appVersion: '1.0.12'
      })
      localStorage.removeItem(AUTH_STARTUP_BASELINE_KEY)
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private-sync-network-error'))
      await expect(onedrive.synchronize()).rejects.toThrow('private-sync-network-error')
      expect(JSON.parse(localStorage.getItem(AUTH_STARTUP_BASELINE_KEY)!)).toMatchObject({
        schema: 1, appVersion: '1.0.12'
      })
      expect(localStorage.getItem(AUTH_STARTUP_BASELINE_KEY)).not.toContain('private')
      localStorage.removeItem(AUTH_STARTUP_BASELINE_KEY)
      msal.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
      await expect(onedrive.synchronize()).rejects.toBeInstanceOf(InteractionRequiredAuthError)
      expect(localStorage.getItem(AUTH_STARTUP_BASELINE_KEY)).toBeNull()
    })

    it('observes initialization counts and missing cached account before navigation without secrets', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      msal.initialize.mockImplementation(async () => {
        const event = {
          name: 'initializeClientApplication', eventId: 'private-event', status: 2 as const,
          authority: 'private-authority', clientId: 'private-client', correlationId: 'private-correlation',
          libraryName: 'msal.js.browser', libraryVersion: '4.30.0',
          startTimeMs: 1000, encryptedCacheExpiredCount: 3, unencryptedCacheCount: 0
        }
        msal.addPerformanceCallback.mock.calls[0][0]([event])
        document.cookie = 'msal.cache.encryption=private-key; path=/'
      })
      msal.loginRedirect.mockImplementation(async (request: RedirectRequest) => {
        expect(request.onRedirectNavigate?.('https://login.microsoftonline.com/authorize')).toBe(true)
      })
      const { onedrive, snapshots } = await observeAuth()
      await onedrive.currentAccount()
      const serialized = snapshots.at(-1)?.startupDiagnostics
      expect(serialized).toBeDefined()
      expect(JSON.parse(serialized!)).toMatchObject({
        msalKeyCookieAtStart: false, cachedAccountBeforeRedirectHandling: null,
        usableAccountCountAfterRedirectHandling: 0,
        cacheCounts: { encrypted: null, expiredEncrypted: 3, unencrypted: 0 },
        silentMethod: 'ssoSilent', silentFailure: 'interaction_required', automaticRedirect: 'started',
        automaticRecoverySkipReason: null
      })
      expect(serialized).not.toContain('private')
      expect(serialized).not.toContain('person@example.com')
      expect(msal.removePerformanceCallback).toHaveBeenCalledExactlyOnceWith('startup-callback')
      expect(localStorage.getItem('last-time-auth-startup-pending')).not.toBeNull()
    })

    it('retains the originating failure across a callback reload and keeps the verified account connected', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      msal.loginRedirect.mockImplementation(async (request: RedirectRequest) => {
        request.onRedirectNavigate?.('https://login.microsoftonline.com/authorize')
      })
      const initial = await observeAuth()
      await initial.onedrive.currentAccount()
      vi.resetModules()
      msal.handleRedirectPromise.mockResolvedValueOnce({ account: account(), state: 'last-time-cold-start-recovery' })
      const callback = await observeAuth()
      expect(await callback.onedrive.currentAccount()).toEqual(account())
      expect(JSON.parse(callback.snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
        outcome: 'connected', automaticRedirect: 'returned',
        beforeRedirect: { silentFailure: 'interaction_required', usableAccountCountAfterRedirectHandling: 0 }
      })
      expect(localStorage.getItem('last-time-auth-startup-pending')).toBeNull()
      expect(localStorage.getItem('last-time-auth-startup-report')).not.toBeNull()
      expect(msal.addPerformanceCallback).toHaveBeenCalledTimes(2)
      expect(msal.removePerformanceCallback).toHaveBeenCalledTimes(2)
    })

    it('records cached token failures and removes callbacks after initialization errors', async () => {
      msal.getAllAccounts.mockReturnValue([account()])
      msal.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
      const initial = await observeAuth()
      await initial.onedrive.currentAccount()
      expect(JSON.parse(initial.snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
        usableAccountCountAfterRedirectHandling: 1, silentMethod: 'acquireTokenSilent', silentFailure: 'interaction_required'
      })
      vi.resetModules()
      msal.initialize.mockRejectedValueOnce(new Error('initialization failed'))
      const failure = await observeAuth()
      await vi.waitFor(() => expect(failure.snapshots.at(-1)?.status).toBe('error'))
      expect(JSON.parse(failure.snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
        outcome: 'error', automaticRecoverySkipReason: 'startup-error'
      })
      expect(msal.removePerformanceCallback).toHaveBeenCalledTimes(2)
    })

    it('does not re-register diagnostics on foreground retries and clears them on explicit sign-out', async () => {
      const { rememberMicrosoftConnection } = await import('../db')
      await rememberMicrosoftConnection('person@example.com')
      msal.ssoSilent.mockRejectedValueOnce(new Error('network failed'))
      const { onedrive, snapshots } = await observeAuth()
      await onedrive.currentAccount()
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!).automaticRecoverySkipReason)
        .toBe('silent-error-not-interactive')
      msal.ssoSilent.mockResolvedValueOnce({ account: account() })
      await expect(onedrive.retryAuthRestore()).resolves.toBe(true)
      expect(msal.addPerformanceCallback).toHaveBeenCalledOnce()
      expect(snapshots.at(-1)?.startupDiagnostics).toBeDefined()
      await onedrive.signOut()
      expect(snapshots.at(-1)).toEqual({ ready: true, status: 'disconnected' })
      expect(localStorage.getItem('last-time-auth-startup-report')).toBeNull()
      expect(localStorage.getItem('last-time-auth-startup-pending')).toBeNull()
    })

    it('preserves successful silent authorization when diagnostic storage is unavailable', async () => {
      msal.getAllAccounts.mockReturnValue([account()])
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private-storage-error') })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private-storage-error') })
      const { onedrive, snapshots } = await observeAuth()
      expect(await onedrive.currentAccount()).toEqual(account())
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
        outcome: 'connected', persistence: 'unavailable', automaticRecoverySkipReason: null
      })
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-storage-error')
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('does not block authorization when performance observation or raw cache observation fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      msal.addPerformanceCallback.mockImplementationOnce(() => { throw new Error('private-observer-error') })
      msal.getAllAccounts.mockReturnValue([account()])
      const getItem = Storage.prototype.getItem
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
        if (key === 'msal.2.account.keys') throw new Error('private-cache-observation-error')
        return getItem.call(this, key)
      })
      const { onedrive, snapshots } = await observeAuth()
      expect(await onedrive.currentAccount()).toEqual(account())
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
        outcome: 'connected', cachedAccountBeforeRedirectHandling: null,
        usableAccountCountAfterRedirectHandling: 1,
        cacheEvidence: { beforeInitialize: { accountIndexState: 'unavailable' } },
        cacheCounts: { encrypted: null, expiredEncrypted: null, unencrypted: null }
      })
      expect(warn).toHaveBeenCalledWith('Unable to observe MSAL startup performance.')
      expect(warn).toHaveBeenCalledWith('Unable to observe MSAL startup cache metadata.')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private')
      expect(msal.removePerformanceCallback).not.toHaveBeenCalled()
    })

    it('rechecks idle eligibility after saving the pending diagnostic and keeps the loop guard', async () => {
      const store = await import('../db')
      await store.rememberMicrosoftConnection('person@example.com')
      const originalSetItem = Storage.prototype.setItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        originalSetItem.call(this, key, value)
        if (key === 'last-time-auth-startup-pending') document.dispatchEvent(new Event('input', { bubbles: true }))
      })
      msal.loginRedirect.mockImplementation(async (request: RedirectRequest) => {
        request.onRedirectNavigate?.('https://login.microsoftonline.com/authorize')
      })
      const { onedrive, snapshots } = await observeAuth()
      expect(await onedrive.currentAccount()).toBeUndefined()
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!)).toMatchObject({
        outcome: 'reconnect-required', automaticRedirect: 'cancelled', automaticRecoverySkipReason: 'user-interaction'
      })
      expect(localStorage.getItem('last-time-auth-startup-pending')).toBeNull()
      expect(await store.readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
    })

    it('captures cache metadata around initialize without an extra SDK account read', async () => {
      const cookie = encodeURIComponent(JSON.stringify({ id: 'private-key-id', key: 'private-key' }))
      document.cookie = `msal.cache.encryption=${cookie}; path=/`
      localStorage.setItem('msal.2.account.keys', JSON.stringify(['private-account-key']))
      localStorage.setItem('private-account-key', JSON.stringify({
        id: 'private-key-id', nonce: 'private-nonce', data: 'private-token'
      }))
      msal.initialize.mockImplementation(async () => {
        expect(msal.getAllAccounts).not.toHaveBeenCalled()
        localStorage.removeItem('private-account-key')
        localStorage.removeItem('msal.2.account.keys')
      })
      const { onedrive, snapshots } = await observeAuth()
      await onedrive.currentAccount()
      expect(msal.getAllAccounts).toHaveBeenCalledOnce()
      const report = snapshots.at(-1)!.startupDiagnostics!
      expect(JSON.parse(report)).toMatchObject({
        cachedAccountBeforeRedirectHandling: null, usableAccountCountAfterRedirectHandling: 0,
        cacheEvidence: {
          beforeInitialize: { accountReferences: 1, presentEntries: 1, matchingKeyEntries: 1 },
          afterInitialize: { accountReferences: 0, presentEntries: 0 }
        }
      })
      expect(report).not.toContain('private')
    })

    it('leaves the post-initialize observation unknown if initialize fails', async () => {
      msal.initialize.mockRejectedValueOnce(new Error('private-initialize-error'))
      const { snapshots } = await observeAuth()
      await vi.waitFor(() => expect(snapshots.at(-1)?.status).toBe('error'))
      expect(JSON.parse(snapshots.at(-1)!.startupDiagnostics!).cacheEvidence).toMatchObject({
        beforeInitialize: { accountIndexState: 'absent' }, afterInitialize: null
      })
      expect(msal.getAllAccounts).not.toHaveBeenCalled()
    })
  })
})
