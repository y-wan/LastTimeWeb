import { InteractionRequiredAuthError, type AccountInfo, type RedirectRequest } from '@azure/msal-browser'
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
  acquireTokenPopup: vi.fn()
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
      expect(snapshots.at(-1)).toEqual({ ready: false, status: 'restoring' })
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

    it.each(['pointerdown', 'keydown', 'input', 'click', 'visibilitychange', 'pagehide', 'online', 'offline'])(
      'cancels startup redirect permanently after %s while SSO is pending', async (event) => {
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
        } else if (['pagehide', 'online', 'offline'].includes(event)) {
          window.dispatchEvent(new Event(event))
        } else {
          document.dispatchEvent(new Event(event, { bubbles: true }))
        }
        rejectSilent(new InteractionRequiredAuthError('interaction_required'))
        expect(await onedrive.currentAccount()).toBeUndefined()
        expect(snapshots.at(-1)).toMatchObject({ status: 'reconnect-required' })
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
      const { onedrive } = await observeAuth()
      await onedrive.currentAccount()
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
      onedrive.subscribeAuth(() => {})
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
})
