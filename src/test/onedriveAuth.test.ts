import { InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_MS_CLIENT_ID', 'test-client-id')
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
  Object.values(msal).forEach((method) => method.mockReset())
  let activeAccount: AccountInfo | null = null
  msal.initialize.mockResolvedValue(undefined)
  msal.handleRedirectPromise.mockResolvedValue(null)
  msal.getActiveAccount.mockImplementation(() => activeAccount)
  msal.getAllAccounts.mockReturnValue([])
  msal.setActiveAccount.mockImplementation((account: AccountInfo | null) => {
    activeAccount = account
  })
  msal.ssoSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
  msal.loginRedirect.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  Reflect.deleteProperty(navigator, 'standalone')
})

describe('installed iPhone Microsoft authorization', () => {
  it('redirects a reconnect and restores the account on the callback load', async () => {
    const { rememberMicrosoftConnection } = await import('../db')
    await rememberMicrosoftConnection('person@example.com')
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
    msal.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError('interaction_required'))
    const onedrive = await import('../onedrive')
    const snapshots: string[] = []
    onedrive.subscribeAuth((snapshot) => snapshots.push(snapshot.status))
    await vi.waitFor(() => expect(snapshots).toContain('connected'))

    await expect(onedrive.synchronize()).rejects.toBeInstanceOf(InteractionRequiredAuthError)
    expect(snapshots.at(-1)).toBe('reconnect-required')
    expect(await onedrive.currentAccount()).toBeUndefined()
    expect(msal.acquireTokenPopup).not.toHaveBeenCalled()
  })
})
