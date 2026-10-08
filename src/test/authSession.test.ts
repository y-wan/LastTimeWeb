import {
  BrowserAuthError,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type EndSessionPopupRequest,
  type PopupRequest,
  type RedirectRequest,
  type SsoSilentRequest
} from '@azure/msal-browser'
import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthStartupDiagnostics } from '../authStartupDiagnostics'
import {
  acquireMicrosoftToken,
  initializeMicrosoftSession,
  signInMicrosoft,
  signOutMicrosoft,
  type MicrosoftAuthClient,
  type MicrosoftAuthStateStore
} from '../authSession'
import {
  claimMicrosoftColdStartRecovery,
  clearMicrosoftColdStartRecovery,
  db,
  readMicrosoftAuthState,
  rememberMicrosoftConnection
} from '../db'

function account(username = 'person@example.com'): AccountInfo {
  return {
    homeAccountId: 'home-account',
    environment: 'login.microsoftonline.com',
    tenantId: 'tenant',
    username,
    localAccountId: 'local-account'
  }
}

function client(overrides: Partial<MicrosoftAuthClient> = {}) {
  const value: MicrosoftAuthClient = {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    getActiveAccount: vi.fn().mockReturnValue(null),
    getAllAccounts: vi.fn().mockReturnValue([]),
    setActiveAccount: vi.fn(),
    ssoSilent: vi.fn().mockRejectedValue(new InteractionRequiredAuthError(
      'interaction_required', 'Session information is not sufficient for single-sign-on.'
    )),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
    loginPopup: vi.fn().mockResolvedValue({ account: account() }),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    logoutPopup: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  return value
}

function indexedDbStore(): MicrosoftAuthStateStore {
  return {
    read: readMicrosoftAuthState,
    remember: rememberMicrosoftConnection,
    forget: () => db.microsoftAuthState.delete('microsoft'),
    claimColdStartRecovery: claimMicrosoftColdStartRecovery,
    clearColdStartRecovery: clearMicrosoftColdStartRecovery
  }
}

function coldStart(msal: MicrosoftAuthClient, overrides: Partial<Parameters<typeof initializeMicrosoftSession>[0]> = {}) {
  return initializeMicrosoftSession({
    client: msal,
    store: indexedDbStore(),
    scopes: ['Files.ReadWrite.AppFolder'],
    online: true,
    coldStartRecovery: { canRedirect: () => true },
    ...overrides
  })
}

beforeEach(async () => {
  await db.microsoftAuthState.clear()
})

describe('MSAL v4 cold-start restoration', () => {
  describe('recovery blocker observation', () => {
    it.each(['sso', 'cached'])('keeps the %s path and guard semantics unchanged while distinguishing blockers', async (path) => {
      for (const [scenario, reason] of [
        ['ineligible', 'initially-hidden'],
        ['guarded', 'previous-attempt'],
        ['missing-hint', 'missing-login-hint'],
        ['claim-denied', 'guard-claim-denied'],
        ['cancelled-after-claim', 'user-interaction']
      ] as const) {
        await db.microsoftAuthState.clear()
        await rememberMicrosoftConnection(scenario === 'missing-hint' ? undefined : 'person@example.com')
        if (scenario === 'guarded') await claimMicrosoftColdStartRecovery('person@example.com')
        const failure = new InteractionRequiredAuthError('interaction_required')
        const msal = client({
          getAllAccounts: vi.fn().mockReturnValue(path === 'cached' ? [account()] : []),
          ssoSilent: vi.fn().mockRejectedValue(failure),
          acquireTokenSilent: vi.fn().mockRejectedValue(failure)
        })
        const canRedirect = vi.fn().mockReturnValue(scenario !== 'ineligible')
        if (scenario === 'cancelled-after-claim') canRedirect.mockReturnValueOnce(true).mockReturnValueOnce(false)
        const claim = vi.fn((hint: string, homeAccountId?: string) => scenario === 'claim-denied'
          ? Promise.resolve(false) : claimMicrosoftColdStartRecovery(hint, homeAccountId))
        const trace = new AuthStartupDiagnostics('1.0.11')
        const snapshot = await coldStart(msal, {
          store: { ...indexedDbStore(), claimColdStartRecovery: claim },
          coldStartRecovery: {
            canRedirect,
            getBlockReason: () => scenario === 'ineligible' ? 'initially-hidden' : 'user-interaction'
          },
          diagnostics: trace
        })
        expect(snapshot).toMatchObject({ ready: true, status: 'reconnect-required' })
        expect(JSON.parse(trace.finish('reconnect-required'))).toMatchObject({
          automaticRedirect: 'not-attempted', automaticRecoverySkipReason: reason,
          silentMethod: path === 'cached' ? 'acquireTokenSilent' : 'ssoSilent'
        })
        expect(canRedirect).toHaveBeenCalledTimes(scenario === 'cancelled-after-claim' ? 2 : 1)
        expect(claim).toHaveBeenCalledTimes(['claim-denied', 'cancelled-after-claim'].includes(scenario) ? 1 : 0)
        expect(msal.loginRedirect).not.toHaveBeenCalled()
        if (['guarded', 'cancelled-after-claim'].includes(scenario)) {
          expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
        } else {
          expect(await readMicrosoftAuthState()).not.toHaveProperty('coldStartRecovery')
        }
      }
    })

    it('retains compatibility with a caller that does not supply a reason provider', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const trace = new AuthStartupDiagnostics('1.0.11')
      await coldStart(client(), { coldStartRecovery: { canRedirect: () => false }, diagnostics: trace })
      expect(JSON.parse(trace.finish('reconnect-required')).automaticRecoverySkipReason).toBe('startup-ineligible')
    })
  })

  it('restores a cached account before attempting network recovery', async () => {
    const cached = account()
    const msal = client({ getAllAccounts: vi.fn().mockReturnValue([cached]) })
    const result = await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true
    })

    expect(result).toEqual({ ready: true, status: 'connected', account: cached })
    expect(msal.setActiveAccount).toHaveBeenCalledWith(cached)
    expect(msal.ssoSilent).not.toHaveBeenCalled()
    expect(await readMicrosoftAuthState()).toEqual({
      key: 'microsoft',
      connectedBefore: true,
      loginHint: 'person@example.com'
    })
  })

  describe('bounded Microsoft startup recovery', () => {
    it('reserves only one recovery attempt atomically and preserves it when remembering an account', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const claims = await Promise.all([
        claimMicrosoftColdStartRecovery('person@example.com', 'home-account'),
        claimMicrosoftColdStartRecovery('person@example.com', 'home-account')
      ])
      expect(claims.sort()).toEqual([false, true])
      await rememberMicrosoftConnection('person@example.com')
      expect(await readMicrosoftAuthState()).toMatchObject({
        coldStartRecovery: { homeAccountId: 'home-account' }
      })
    })

    it('does not reserve a recovery without an unchanged prior account hint', async () => {
      expect(await claimMicrosoftColdStartRecovery('person@example.com')).toBe(false)
      await rememberMicrosoftConnection()
      expect(await claimMicrosoftColdStartRecovery('person@example.com')).toBe(false)
      await rememberMicrosoftConnection('other@example.com')
      expect(await claimMicrosoftColdStartRecovery('person@example.com')).toBe(false)
      expect(await readMicrosoftAuthState()).not.toHaveProperty('coldStartRecovery')
    })

    it('uses prompt=none after silent SSO requires interaction without claiming connection', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const msal = client()
      expect(await coldStart(msal)).toEqual({ ready: false, status: 'restoring' })
      expect(msal.loginRedirect).toHaveBeenCalledExactlyOnceWith({
        scopes: ['Files.ReadWrite.AppFolder'],
        prompt: 'none',
        loginHint: 'person@example.com',
        state: 'last-time-cold-start-recovery',
        onRedirectNavigate: expect.any(Function)
      })
      expect(msal.loginPopup).not.toHaveBeenCalled()
      expect(msal.setActiveAccount).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery', {})
    })

    it('validates the cached token before connecting and binds recovery to the cached identity', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const cached = account()
      const msal = client({
        getAllAccounts: vi.fn().mockReturnValue([cached]),
        acquireTokenSilent: vi.fn().mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
      })
      expect(await coldStart(msal)).toEqual({ ready: false, status: 'restoring' })
      expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ account: cached, scopes: ['Files.ReadWrite.AppFolder'] })
      expect(msal.loginRedirect).toHaveBeenCalledExactlyOnceWith({
        scopes: ['Files.ReadWrite.AppFolder'],
        prompt: 'none',
        loginHint: 'person@example.com',
        account: cached,
        state: 'last-time-cold-start-recovery',
        onRedirectNavigate: expect.any(Function)
      })
      expect(msal.ssoSilent).not.toHaveBeenCalled()
      expect(msal.setActiveAccount).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).toMatchObject({
        coldStartRecovery: { homeAccountId: cached.homeAccountId }
      })
    })

    it('retains the guard when a cached account is available offline', async () => {
      await rememberMicrosoftConnection('person@example.com')
      await claimMicrosoftColdStartRecovery('person@example.com', 'home-account')
      const cached = account()
      const msal = client({ getAllAccounts: vi.fn().mockReturnValue([cached]) })
      expect(await coldStart(msal, { online: false })).toEqual({
        ready: true, status: 'connected', account: cached
      })
      expect(msal.acquireTokenSilent).not.toHaveBeenCalled()
      expect(msal.loginRedirect).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
    })

    it.each([false, true])('never redirects transient errors for cached=%s', async (cached) => {
      await rememberMicrosoftConnection('person@example.com')
      const msal = client({
        getAllAccounts: vi.fn().mockReturnValue(cached ? [account()] : []),
        ssoSilent: vi.fn().mockRejectedValue(new BrowserAuthError('monitor_window_timeout')),
        acquireTokenSilent: vi.fn().mockRejectedValue(new Error('network failed'))
      })
      expect(await coldStart(msal)).toMatchObject({ ready: true, status: 'restore-failed', error: expect.any(String) })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).not.toHaveProperty('coldStartRecovery')
    })

    it('does not redirect when startup eligibility is cancelled', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const msal = client()
      expect(await coldStart(msal, { coldStartRecovery: { canRedirect: () => false } })).toMatchObject({
        ready: true, status: 'reconnect-required', error: expect.stringContaining('interaction_required')
      })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).not.toHaveProperty('coldStartRecovery')
    })

    it('checks eligibility again after reserving the durable guard', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const msal = client()
      const canRedirect = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
      expect(await coldStart(msal, { coldStartRecovery: { canRedirect } })).toMatchObject({
        ready: true, status: 'reconnect-required'
      })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
    })

    it('retains the original authorization details if redirect initiation fails', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const msal = client({ loginRedirect: vi.fn().mockRejectedValue(new Error('navigation failed')) })
      expect(await coldStart(msal)).toEqual({
        ready: true,
        status: 'reconnect-required',
        error: expect.stringMatching(/interaction_required[\s\S]*navigation failed/)
      })
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
      await coldStart(msal)
      expect(msal.loginRedirect).toHaveBeenCalledOnce()
    })

    it('fails visibly without navigation if durable guard storage fails', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const msal = client()
      const store = {
        ...indexedDbStore(),
        claimColdStartRecovery: vi.fn().mockRejectedValue(new Error('guard write failed'))
      }
      expect(await coldStart(msal, { store })).toMatchObject({
        ready: true,
        status: 'reconnect-required',
        error: expect.stringMatching(/interaction_required[\s\S]*guard write failed/)
      })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('stops at a failed callback even if a cached account remains', async () => {
      await rememberMicrosoftConnection('person@example.com')
      await claimMicrosoftColdStartRecovery('person@example.com', 'home-account')
      const msal = client({
        getAllAccounts: vi.fn().mockReturnValue([account()]),
        handleRedirectPromise: vi.fn().mockRejectedValue(new Error('Microsoft callback denied'))
      })
      expect(await coldStart(msal)).toEqual({
        ready: true, status: 'reconnect-required', error: 'Microsoft callback denied'
      })
      expect(msal.acquireTokenSilent).not.toHaveBeenCalled()
      expect(msal.loginRedirect).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
    })

    it('does not loop when callback success is followed by token failure', async () => {
      await rememberMicrosoftConnection('person@example.com')
      await claimMicrosoftColdStartRecovery('person@example.com', 'home-account')
      const msal = client({
        handleRedirectPromise: vi.fn().mockResolvedValue({
          account: account(), state: 'last-time-cold-start-recovery'
        }),
        acquireTokenSilent: vi.fn().mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
      })
      expect(await coldStart(msal)).toMatchObject({
        ready: true, status: 'reconnect-required', error: expect.stringContaining('interaction_required')
      })
      expect(msal.loginRedirect).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
    })

    it('stops automatic callbacks whose durable state is unavailable', async () => {
      await rememberMicrosoftConnection('person@example.com')
      const msal = client({
        handleRedirectPromise: vi.fn().mockResolvedValue({
          account: account(), state: 'last-time-cold-start-recovery'
        })
      })
      expect(await coldStart(msal)).toMatchObject({
        ready: true, status: 'reconnect-required', error: expect.stringContaining('state is unavailable')
      })
      expect(msal.acquireTokenSilent).not.toHaveBeenCalled()
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it.each([false, true])('refuses unexpected accounts for cached-identity guard=%s', async (cached) => {
      await rememberMicrosoftConnection('person@example.com')
      await claimMicrosoftColdStartRecovery('person@example.com', cached ? 'home-account' : undefined)
      const unexpected = { ...account('other@example.com'), homeAccountId: 'other-home-account' }
      const msal = client({
        handleRedirectPromise: vi.fn().mockResolvedValue({
          account: unexpected, state: 'last-time-cold-start-recovery'
        })
      })
      expect(await coldStart(msal)).toMatchObject({
        ready: true, status: 'reconnect-required', error: expect.stringContaining('different account')
      })
      expect(msal.setActiveAccount).toHaveBeenCalledWith(null)
      expect(msal.acquireTokenSilent).not.toHaveBeenCalled()
      expect(msal.loginRedirect).not.toHaveBeenCalled()
      expect(await readMicrosoftAuthState()).toMatchObject({ loginHint: 'person@example.com' })
    })

    it.each(['callback', 'cached', 'sso'])('clears the guard only after successful %s silent authorization', async (path) => {
      await rememberMicrosoftConnection('person@example.com')
      await claimMicrosoftColdStartRecovery('person@example.com')
      const restored = account('PERSON@example.com')
      const msal = client({
        handleRedirectPromise: vi.fn().mockResolvedValue(path === 'callback'
          ? { account: restored, state: 'last-time-cold-start-recovery' } : null),
        getAllAccounts: vi.fn().mockReturnValue(path === 'cached' ? [restored] : []),
        ssoSilent: vi.fn().mockResolvedValue({ account: restored })
      })
      expect(await coldStart(msal)).toEqual({ ready: true, status: 'connected', account: restored })
      expect(msal.acquireTokenSilent).toHaveBeenCalledOnce()
      expect(await readMicrosoftAuthState()).not.toHaveProperty('coldStartRecovery')
      expect(msal.loginRedirect).not.toHaveBeenCalled()
    })

    it('clears the guard for explicit reconnect without restricting intentional account selection', async () => {
      await rememberMicrosoftConnection('person@example.com')
      await claimMicrosoftColdStartRecovery('person@example.com', 'home-account')
      const selected = { ...account('chosen@example.com'), homeAccountId: 'chosen-account' }
      const msal = client({ loginPopup: vi.fn().mockResolvedValue({ account: selected }) })
      expect(await signInMicrosoft({
        client: msal, store: indexedDbStore(), scopes: ['Files.ReadWrite.AppFolder'], reconnecting: true
      })).toEqual(selected)
      expect(await readMicrosoftAuthState()).toEqual({
        key: 'microsoft', connectedBefore: true, loginHint: 'chosen@example.com'
      })
    })

    it('uses real MSAL request cleanup when the final navigation gate cancels recovery', async () => {
      await rememberMicrosoftConnection('person@example.com')
      vi.stubGlobal('crypto', webcrypto)
      const networkClient = {
        sendGetRequestAsync: vi.fn().mockRejectedValue(new Error('Unexpected network request')),
        sendPostRequestAsync: vi.fn().mockRejectedValue(new Error('Unexpected network request'))
      }
      const realClient = new PublicClientApplication({
        auth: {
          clientId: '00000000-0000-0000-0000-000000000001',
          authority: 'https://login.microsoftonline.com/common',
          redirectUri: 'http://localhost/',
          cloudDiscoveryMetadata: JSON.stringify({
            tenant_discovery_endpoint: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
            metadata: [{
              preferred_network: 'login.microsoftonline.com',
              preferred_cache: 'login.microsoftonline.com',
              aliases: ['login.microsoftonline.com']
            }]
          }),
          authorityMetadata: JSON.stringify({
            authorization_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
            token_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
            end_session_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/logout',
            issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
            jwks_uri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys'
          })
        },
        system: { networkClient }
      })
      try {
        await realClient.initialize()
        const msal = client({ loginRedirect: vi.fn((request: RedirectRequest) => realClient.loginRedirect(request)) })
        const canRedirect = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false)
        expect(await coldStart(msal, { coldStartRecovery: { canRedirect } })).toMatchObject({
          ready: true,
          status: 'reconnect-required',
          error: expect.stringMatching(/interaction_required[\s\S]*recovery was cancelled/)
        })
        expect(canRedirect).toHaveBeenCalledTimes(3)
        expect(await readMicrosoftAuthState()).toHaveProperty('coldStartRecovery')
        await expect(realClient.loginRedirect({
          scopes: ['Files.ReadWrite.AppFolder'],
          onRedirectNavigate: () => { throw new Error('Explicit reconnect reached navigation') }
        })).rejects.toThrow('Explicit reconnect reached navigation')
        expect(networkClient.sendGetRequestAsync).not.toHaveBeenCalled()
        expect(networkClient.sendPostRequestAsync).not.toHaveBeenCalled()
      } finally {
        await realClient.clearCache()
        vi.unstubAllGlobals()
      }
    })

    it('clears the guard for explicit sign-out', async () => {
      await rememberMicrosoftConnection('person@example.com')
      await claimMicrosoftColdStartRecovery('person@example.com')
      await signOutMicrosoft({ client: client(), store: indexedDbStore() })
      expect(await readMicrosoftAuthState()).toBeUndefined()
    })
  })

  it('uses the IndexedDB hint after the encrypted MSAL account cache expires', async () => {
    await rememberMicrosoftConnection('person@example.com')
    const restored = account()
    const msal = client({
      getAllAccounts: vi.fn().mockReturnValue([]),
      ssoSilent: vi.fn().mockResolvedValue({ account: restored })
    })
    const onRestoring = vi.fn()

    const result = await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true,
      onRestoring
    })

    expect(onRestoring).toHaveBeenCalledOnce()
    expect(msal.ssoSilent).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite.AppFolder'],
      loginHint: 'person@example.com'
    } satisfies SsoSilentRequest)
    expect(result).toEqual({ ready: true, status: 'connected', account: restored })
    expect(msal.setActiveAccount).toHaveBeenCalledWith(restored)
  })

  it('shows reconnect when silent SSO requires interaction and retains the hint', async () => {
    await rememberMicrosoftConnection('person@example.com')
    const msal = client()

    expect(await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true
    })).toEqual({
      ready: true,
      status: 'reconnect-required',
      error: expect.stringContaining('interaction_required')
    })
    expect(await readMicrosoftAuthState()).toMatchObject({ loginHint: 'person@example.com' })
  })

  it.each([
    new Error('network failed'),
    new BrowserAuthError('monitor_window_timeout')
  ])('keeps restoration failure retryable with its details: %s', async (failure) => {
    await rememberMicrosoftConnection('person@example.com')
    const msal = client({ ssoSilent: vi.fn().mockRejectedValue(failure) })

    expect(await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true
    })).toEqual({
      ready: true,
      status: 'restore-failed',
      error: failure.message
    })
    expect(await readMicrosoftAuthState()).toMatchObject({ loginHint: 'person@example.com' })
    expect(msal.loginPopup).not.toHaveBeenCalled()
    expect(msal.loginRedirect).not.toHaveBeenCalled()
  })

  it('stays truthful while offline without erasing the prior connection', async () => {
    await rememberMicrosoftConnection('person@example.com')
    const msal = client()

    expect(await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: false
    })).toEqual({ ready: true, status: 'reconnect-required', offline: true })
    expect(msal.ssoSilent).not.toHaveBeenCalled()
    expect(await readMicrosoftAuthState()).toMatchObject({ loginHint: 'person@example.com' })
  })

  it('shows first-use disconnected state when no prior marker exists', async () => {
    const msal = client()

    expect(await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true
    })).toEqual({ ready: true, status: 'disconnected' })
    expect(msal.ssoSilent).not.toHaveBeenCalled()
  })

  it('keeps a cached account connected when redirect processing fails', async () => {
    const cached = account()
    const msal = client({
      handleRedirectPromise: vi.fn().mockRejectedValue(new Error('stale redirect state')),
      getAllAccounts: vi.fn().mockReturnValue([cached])
    })

    expect(await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true
    })).toEqual({
      ready: true,
      status: 'connected',
      account: cached,
      error: 'stale redirect state'
    })
  })

  it('shows a redirect callback failure without losing the reconnect hint', async () => {
    await rememberMicrosoftConnection('person@example.com')
    const msal = client({
      handleRedirectPromise: vi.fn().mockRejectedValue(new Error('redirect failed'))
    })

    expect(await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true
    })).toEqual({
      ready: true,
      status: 'reconnect-required',
      error: 'redirect failed'
    })
    expect(msal.ssoSilent).not.toHaveBeenCalled()
    expect(await readMicrosoftAuthState()).toMatchObject({ loginHint: 'person@example.com' })
  })

  it('restores a redirected account and resumes the existing connection', async () => {
    await rememberMicrosoftConnection('person@example.com')
    const restored = account()
    const msal = client({
      handleRedirectPromise: vi.fn().mockResolvedValue({ account: restored })
    })

    expect(await initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true
    })).toEqual({ ready: true, status: 'connected', account: restored })
    expect(msal.setActiveAccount).toHaveBeenCalledWith(restored)
    expect(msal.ssoSilent).not.toHaveBeenCalled()
  })

  it('keeps genuine MSAL initialization failures distinct from signed-out state', async () => {
    const msal = client({ initialize: vi.fn().mockRejectedValue(new Error('storage unavailable')) })

    await expect(initializeMicrosoftSession({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      online: true
    })).rejects.toThrow('storage unavailable')
    expect(msal.getAllAccounts).not.toHaveBeenCalled()
  })

  it('prefills reconnect but preserves account selection for first-time sign-in', async () => {
    await rememberMicrosoftConnection('person@example.com')
    const reconnectClient = client()
    await signInMicrosoft({
      client: reconnectClient,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      reconnecting: true
    })
    expect(reconnectClient.loginPopup).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite.AppFolder'],
      loginHint: 'person@example.com'
    } satisfies PopupRequest)

    await db.microsoftAuthState.clear()
    const firstUseClient = client()
    await signInMicrosoft({
      client: firstUseClient,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      reconnecting: false
    })
    expect(firstUseClient.loginPopup).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite.AppFolder'],
      prompt: 'select_account'
    } satisfies PopupRequest)
  })

  it('redirects a reconnect without opening a popup or claiming completion before the callback', async () => {
    await rememberMicrosoftConnection('person@example.com')
    const msal = client()

    expect(await signInMicrosoft({
      client: msal,
      store: indexedDbStore(),
      scopes: ['Files.ReadWrite.AppFolder'],
      reconnecting: true,
      redirect: true
    })).toBeUndefined()
    expect(msal.loginRedirect).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite.AppFolder'],
      loginHint: 'person@example.com'
    } satisfies RedirectRequest)
    expect(msal.loginPopup).not.toHaveBeenCalled()
  })

  it('asks for an explicit reconnect instead of opening a popup during iPhone background sync', async () => {
    const failure = new InteractionRequiredAuthError('interaction_required')
    const tokenClient = {
      acquireTokenSilent: vi.fn().mockRejectedValue(failure),
      acquireTokenPopup: vi.fn()
    }
    const onReconnectRequired = vi.fn()

    await expect(acquireMicrosoftToken({
      client: tokenClient,
      account: account(),
      scopes: ['Files.ReadWrite.AppFolder'],
      redirectOnInteraction: true,
      onReconnectRequired
    })).rejects.toBe(failure)
    expect(onReconnectRequired).toHaveBeenCalledOnce()
    expect(tokenClient.acquireTokenPopup).not.toHaveBeenCalled()
  })

  it('preserves desktop interactive token acquisition and propagates unrelated failures', async () => {
    const failure = new InteractionRequiredAuthError('interaction_required')
    const tokenClient = {
      acquireTokenSilent: vi.fn().mockRejectedValueOnce(failure).mockRejectedValueOnce(new Error('network failed')),
      acquireTokenPopup: vi.fn().mockResolvedValue({ accessToken: 'desktop-token' })
    }
    const onReconnectRequired = vi.fn()
    const input = {
      client: tokenClient,
      account: account(),
      scopes: ['Files.ReadWrite.AppFolder'],
      redirectOnInteraction: false,
      onReconnectRequired
    }

    await expect(acquireMicrosoftToken(input)).resolves.toBe('desktop-token')
    await expect(acquireMicrosoftToken(input)).rejects.toThrow('network failed')
    expect(tokenClient.acquireTokenPopup).toHaveBeenCalledOnce()
    expect(onReconnectRequired).not.toHaveBeenCalled()
  })

  it('keeps iPhone token network errors distinct from renewed authorization', async () => {
    const tokenClient = {
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error('network failed')),
      acquireTokenPopup: vi.fn()
    }
    const onReconnectRequired = vi.fn()

    await expect(acquireMicrosoftToken({
      client: tokenClient,
      account: account(),
      scopes: ['Files.ReadWrite.AppFolder'],
      redirectOnInteraction: true,
      onReconnectRequired
    })).rejects.toThrow('network failed')
    expect(onReconnectRequired).not.toHaveBeenCalled()
    expect(tokenClient.acquireTokenPopup).not.toHaveBeenCalled()
  })

  it('clears the marker on explicit logout even when the popup fails', async () => {
    await rememberMicrosoftConnection('person@example.com')
    const msal = client({
      logoutPopup: vi.fn((request: EndSessionPopupRequest) => {
        expect(request.account?.homeAccountId).toBe('home-account')
        return Promise.reject(new Error('popup closed'))
      })
    })

    await expect(signOutMicrosoft({
      client: msal,
      store: indexedDbStore(),
      account: account()
    })).rejects.toThrow('popup closed')
    expect(await readMicrosoftAuthState()).toBeUndefined()
  })
})
