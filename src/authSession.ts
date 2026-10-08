import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type EndSessionPopupRequest,
  type PopupRequest,
  type RedirectRequest,
  type SsoSilentRequest
} from '@azure/msal-browser'
import { selectAccount } from './auth'
import type { AuthStartupDiagnostics, RecoverySkipReason } from './authStartupDiagnostics'
import type { MicrosoftAuthStateRecord } from './types'

export type AuthStatus = 'checking' | 'restoring' | 'connected' | 'disconnected' | 'reconnect-required' | 'restore-failed' | 'error'

export interface AuthSnapshot {
  ready: boolean
  status: AuthStatus
  account?: AccountInfo
  error?: string
  offline?: boolean
  startupDiagnostics?: string
}

export interface MicrosoftAuthClient extends Pick<MicrosoftTokenClient, 'acquireTokenSilent'> {
  initialize(): Promise<void>
  handleRedirectPromise(): Promise<{ account: AccountInfo; state?: string } | null>
  getActiveAccount(): AccountInfo | null
  getAllAccounts(): AccountInfo[]
  setActiveAccount(account: AccountInfo | null): void
  ssoSilent(request: SsoSilentRequest): Promise<{ account: AccountInfo }>
  loginPopup(request: PopupRequest): Promise<{ account: AccountInfo }>
  loginRedirect(request: RedirectRequest): Promise<void>
  logoutPopup(request: EndSessionPopupRequest): Promise<void>
}

export interface MicrosoftAuthStateStore {
  read(): Promise<MicrosoftAuthStateRecord | undefined>
  remember(loginHint?: string): Promise<unknown>
  forget(): Promise<unknown>
  claimColdStartRecovery(loginHint: string, homeAccountId?: string): Promise<boolean>
  clearColdStartRecovery(): Promise<unknown>
}

export interface MicrosoftTokenClient {
  acquireTokenSilent(request: { account: AccountInfo; scopes: string[] }): Promise<{ accessToken: string }>
  acquireTokenPopup(request: { account: AccountInfo; scopes: string[] }): Promise<{ accessToken: string }>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function rememberAccount(store: MicrosoftAuthStateStore, account: AccountInfo) {
  await store.remember(account.username || undefined)
}

const COLD_START_RECOVERY_STATE = 'last-time-cold-start-recovery'

export async function initializeMicrosoftSession(input: {
  client: MicrosoftAuthClient
  store: MicrosoftAuthStateStore
  scopes: string[]
  online: boolean
  onRestoring?: () => void
  coldStartRecovery?: {
    canRedirect: () => boolean
    getBlockReason?: () => RecoverySkipReason
  }
  diagnostics?: AuthStartupDiagnostics
}): Promise<AuthSnapshot> {
  const { client, store, scopes, online, onRestoring, coldStartRecovery, diagnostics } = input
  const measure = <T>(stage: 'initialize' | 'redirectResult' | 'silent', operation: () => Promise<T>, method?: 'acquireTokenSilent' | 'ssoSilent') =>
    diagnostics ? diagnostics.measure(stage, operation, method) : operation()
  await measure('initialize', () => client.initialize())
  if (diagnostics) {
    try {
      diagnostics.recordCachedAccount(client.getAllAccounts().length > 0)
    } catch {
      console.warn('Unable to observe the cached MSAL account at startup.')
    }
  }

  const priorConnection = await store.read()
  let redirectResult: { account: AccountInfo; state?: string } | null = null
  let redirectError: unknown
  try {
    redirectResult = await measure('redirectResult', () => client.handleRedirectPromise())
  } catch (error) {
    redirectError = error
  }

  const account = selectAccount(redirectResult?.account, client.getActiveAccount(), client.getAllAccounts())

  if (redirectError && (coldStartRecovery || !account)) {
    diagnostics?.recordRecoverySkip('redirect-callback-error')
    return {
      ready: true,
      status: priorConnection ? 'reconnect-required' : 'error',
      error: errorMessage(redirectError)
    }
  }
  if (redirectResult?.state === COLD_START_RECOVERY_STATE && !priorConnection?.coldStartRecovery) {
    diagnostics?.recordRecoverySkip('missing-recovery-state')
    client.setActiveAccount(null)
    return {
      ready: true,
      status: 'reconnect-required',
      error: 'Microsoft recovery state is unavailable. Reconnect explicitly.'
    }
  }
  if (redirectResult?.state === COLD_START_RECOVERY_STATE && priorConnection?.coldStartRecovery) {
    diagnostics?.confirmAutomaticReturn()
  }

  async function finishRestoration(restored: AccountInfo, verified = false): Promise<AuthSnapshot> {
    const recovery = priorConnection?.coldStartRecovery
    if (recovery && (recovery.homeAccountId
      ? recovery.homeAccountId !== restored.homeAccountId
      : !priorConnection?.loginHint ||
        priorConnection.loginHint.trim().toLowerCase() !== restored.username.trim().toLowerCase())) {
      diagnostics?.recordRecoverySkip('account-mismatch')
      client.setActiveAccount(null)
      return {
        ready: true,
        status: 'reconnect-required',
        error: 'Microsoft recovery returned a different account. Reconnect explicitly to choose an account.'
      }
    }
    if (coldStartRecovery && online) {
      await measure('silent', () => client.acquireTokenSilent({ account: restored, scopes }), 'acquireTokenSilent')
      verified = true
    }
    client.setActiveAccount(restored)
    await rememberAccount(store, restored)
    if (verified) await store.clearColdStartRecovery()
    return {
      ready: true,
      status: 'connected',
      account: restored,
      ...(redirectError ? { error: errorMessage(redirectError) } : {})
    }
  }

  async function restoreAfterFailure(error: unknown, expected?: AccountInfo): Promise<AuthSnapshot> {
    const failed: AuthSnapshot = {
      ready: true,
      status: error instanceof InteractionRequiredAuthError ? 'reconnect-required' : 'restore-failed',
      error: errorMessage(error)
    }
    const skip = (reason: RecoverySkipReason) => {
      diagnostics?.recordRecoverySkip(reason)
      return failed
    }
    const skipIneligible = () => skip(coldStartRecovery?.getBlockReason?.() ?? 'startup-ineligible')
    if (!(error instanceof InteractionRequiredAuthError)) return skip('silent-error-not-interactive')
    if (!online) return skip('offline')
    if (!coldStartRecovery?.canRedirect()) return skipIneligible()
    if (redirectResult) return skip('redirect-result-present')
    if (priorConnection?.coldStartRecovery) return skip('previous-attempt')
    if (!priorConnection?.loginHint) return skip('missing-login-hint')
    try {
      if (!await store.claimColdStartRecovery(priorConnection.loginHint, expected?.homeAccountId)) {
        return skip('guard-claim-denied')
      }
      if (!coldStartRecovery.canRedirect()) return skipIneligible()
      onRestoring?.()
      await client.loginRedirect({
        scopes,
        prompt: 'none',
        loginHint: priorConnection.loginHint,
        ...(expected ? { account: expected } : {}),
        state: COLD_START_RECOVERY_STATE,
        onRedirectNavigate: () => {
          if (diagnostics && coldStartRecovery.canRedirect()) diagnostics.beforeNavigation()
          if (!coldStartRecovery.canRedirect()) {
            skipIneligible()
            diagnostics?.cancelNavigation()
            throw new Error('Automatic Microsoft recovery was cancelled because the app is no longer idle at startup.')
          }
          return true
        }
      })
      return { ready: false, status: 'restoring' }
    } catch (recoveryError) {
      diagnostics?.recordRecoverySkip('recovery-start-failed')
      diagnostics?.cancelNavigation()
      return {
        ready: true,
        status: 'reconnect-required',
        error: `${errorMessage(error)}\nCold-start recovery failed: ${errorMessage(recoveryError)}`
      }
    }
  }

  if (account) {
    if (coldStartRecovery && online) onRestoring?.()
    try {
      return await finishRestoration(account)
    } catch (error) {
      if (!coldStartRecovery) throw error
      return restoreAfterFailure(error, account)
    }
  }
  if (!priorConnection) {
    return { ready: true, status: 'disconnected' }
  }

  if (!online) {
    diagnostics?.recordRecoverySkip('offline')
    return { ready: true, status: 'reconnect-required', offline: true }
  }

  onRestoring?.()
  try {
    const result = await measure('silent', () => client.ssoSilent({
      scopes,
      ...(priorConnection.loginHint ? { loginHint: priorConnection.loginHint } : {})
    }), 'ssoSilent')
    return await finishRestoration(result.account, true)
  } catch (error) {
    return restoreAfterFailure(error)
  }
}

export async function signInMicrosoft(input: {
  client: MicrosoftAuthClient
  store: MicrosoftAuthStateStore
  scopes: string[]
  reconnecting: boolean
  redirect?: boolean
}) {
  const priorConnection = input.reconnecting ? await input.store.read() : undefined
  await input.store.clearColdStartRecovery()
  const request: PopupRequest & RedirectRequest = priorConnection?.loginHint
    ? { scopes: input.scopes, loginHint: priorConnection.loginHint }
    : { scopes: input.scopes, prompt: 'select_account' }
  if (input.redirect) {
    await input.client.loginRedirect(request)
    return undefined
  }
  const result = await input.client.loginPopup(request)
  input.client.setActiveAccount(result.account)
  await rememberAccount(input.store, result.account)
  return result.account
}

export async function signOutMicrosoft(input: {
  client: MicrosoftAuthClient
  store: MicrosoftAuthStateStore
  account?: AccountInfo
}) {
  try {
    if (input.account) await input.client.logoutPopup({ account: input.account })
  } finally {
    await input.store.forget()
  }
}

export async function acquireMicrosoftToken(input: {
  client: MicrosoftTokenClient
  account: AccountInfo
  scopes: string[]
  redirectOnInteraction: boolean
  onReconnectRequired: () => void
}) {
  const request = { account: input.account, scopes: input.scopes }
  try {
    return (await input.client.acquireTokenSilent(request)).accessToken
  } catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error
    if (input.redirectOnInteraction) {
      input.onReconnectRequired()
      throw error
    }
    return (await input.client.acquireTokenPopup(request)).accessToken
  }
}
