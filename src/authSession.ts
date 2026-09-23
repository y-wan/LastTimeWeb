import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type EndSessionPopupRequest,
  type PopupRequest,
  type RedirectRequest,
  type SsoSilentRequest
} from '@azure/msal-browser'
import { selectAccount } from './auth'
import type { MicrosoftAuthStateRecord } from './types'

export type AuthStatus = 'checking' | 'restoring' | 'connected' | 'disconnected' | 'reconnect-required' | 'error'

export interface AuthSnapshot {
  ready: boolean
  status: AuthStatus
  account?: AccountInfo
  error?: string
  offline?: boolean
}

export interface MicrosoftAuthClient {
  initialize(): Promise<void>
  handleRedirectPromise(): Promise<{ account: AccountInfo } | null>
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

export async function initializeMicrosoftSession(input: {
  client: MicrosoftAuthClient
  store: MicrosoftAuthStateStore
  scopes: string[]
  online: boolean
  onRestoring?: () => void
}): Promise<AuthSnapshot> {
  const { client, store, scopes, online, onRestoring } = input
  await client.initialize()

  let redirectAccount: AccountInfo | null | undefined
  let redirectError: unknown
  try {
    redirectAccount = (await client.handleRedirectPromise())?.account
  } catch (error) {
    redirectError = error
  }

  const account = selectAccount(redirectAccount, client.getActiveAccount(), client.getAllAccounts())
  if (account) {
    client.setActiveAccount(account)
    await rememberAccount(store, account)
    return {
      ready: true,
      status: 'connected',
      account,
      ...(redirectError ? { error: errorMessage(redirectError) } : {})
    }
  }

  const priorConnection = await store.read()
  if (redirectError) {
    return {
      ready: true,
      status: priorConnection ? 'reconnect-required' : 'error',
      error: errorMessage(redirectError)
    }
  }
  if (!priorConnection) {
    return { ready: true, status: 'disconnected' }
  }

  if (!online) {
    return { ready: true, status: 'reconnect-required', offline: true }
  }

  onRestoring?.()
  try {
    const result = await client.ssoSilent({
      scopes,
      ...(priorConnection.loginHint ? { loginHint: priorConnection.loginHint } : {})
    })
    client.setActiveAccount(result.account)
    await rememberAccount(store, result.account)
    return { ready: true, status: 'connected', account: result.account }
  } catch {
    return { ready: true, status: 'reconnect-required' }
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
