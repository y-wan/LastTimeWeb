import type { AccountInfo, EndSessionPopupRequest, PopupRequest, SsoSilentRequest } from '@azure/msal-browser'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initializeMicrosoftSession,
  signInMicrosoft,
  signOutMicrosoft,
  type MicrosoftAuthClient,
  type MicrosoftAuthStateStore
} from '../authSession'
import { db, readMicrosoftAuthState, rememberMicrosoftConnection } from '../db'

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
    ssoSilent: vi.fn().mockRejectedValue(new Error('interaction_required')),
    loginPopup: vi.fn().mockResolvedValue({ account: account() }),
    logoutPopup: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  return value
}

function indexedDbStore(): MicrosoftAuthStateStore {
  return {
    read: readMicrosoftAuthState,
    remember: rememberMicrosoftConnection,
    forget: () => db.microsoftAuthState.delete('microsoft')
  }
}

beforeEach(async () => {
  await db.microsoftAuthState.clear()
})

describe('MSAL v4 cold-start restoration', () => {
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
    })).toEqual({ ready: true, status: 'reconnect-required' })
    expect(await readMicrosoftAuthState()).toMatchObject({ loginHint: 'person@example.com' })
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
