import {
  BrowserCacheLocation, InteractionRequiredAuthError, PublicClientApplication,
  type AccountInfo, type Configuration
} from '@azure/msal-browser'
import { resolveCommonAuthority, rootRedirectUri, selectAccount } from './auth'
import { db, nowIso } from './db'
import { withDataOperationLock } from './operationLock'
import {
  PreconditionFailedError,
  synchronizeWithRetries,
  uploadConditionHeaders,
  type RemoteIdentity,
  type RemoteSnapshot
} from './syncEngine'
import { syncMetaKey } from './syncStatus'
import type { SyncDocument } from './types'

const clientId = import.meta.env.VITE_MS_CLIENT_ID as string | undefined
const authority = resolveCommonAuthority()
const scopes = ['Files.ReadWrite.AppFolder']
const itemUrl = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/last-time-data.json'
const fileUrl = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/last-time-data.json:/content'

let msal: PublicClientApplication | undefined
let initialization: Promise<PublicClientApplication | undefined> | undefined

export interface AuthSnapshot {
  ready: boolean
  account?: AccountInfo
  error?: string
}

let authSnapshot: AuthSnapshot = { ready: !clientId }
const authListeners = new Set<(snapshot: AuthSnapshot) => void>()

function publishAuth(snapshot: AuthSnapshot) {
  authSnapshot = snapshot
  for (const listener of authListeners) listener(snapshot)
}

function getMsal() {
  if (!clientId) return undefined
  if (!msal) {
    const config: Configuration = {
      auth: {
        clientId,
        authority,
        redirectUri: rootRedirectUri(window.location.origin),
        postLogoutRedirectUri: rootRedirectUri(window.location.origin)
      },
      cache: { cacheLocation: BrowserCacheLocation.LocalStorage }
    }
    msal = new PublicClientApplication(config)
  }
  return msal
}

async function initialize() {
  const instance = getMsal()
  if (!instance) return undefined
  if (!initialization) {
    const attempt = (async () => {
      try {
        await instance.initialize()
        const result = await instance.handleRedirectPromise()
        const account = selectAccount(result?.account, instance.getActiveAccount(), instance.getAllAccounts())
        if (account) instance.setActiveAccount(account)
        publishAuth({ ready: true, account })
        return instance
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        publishAuth({ ready: true, error: message })
        throw error
      }
    })()
    initialization = attempt.catch((error) => {
      initialization = undefined
      throw error
    })
  }
  return initialization
}

export function isSyncConfigured() {
  return Boolean(clientId)
}

export async function currentAccount() {
  const instance = await initialize()
  if (!instance) return undefined
  const account = selectAccount(undefined, instance.getActiveAccount(), instance.getAllAccounts())
  if (account && instance.getActiveAccount()?.homeAccountId !== account.homeAccountId) {
    instance.setActiveAccount(account)
  }
  if (authSnapshot.account?.homeAccountId !== account?.homeAccountId || !authSnapshot.ready || authSnapshot.error) {
    publishAuth({ ready: true, account })
  }
  return account
}

export function subscribeAuth(listener: (snapshot: AuthSnapshot) => void) {
  authListeners.add(listener)
  listener(authSnapshot)
  void initialize().catch(() => {
    // initialize publishes the actionable error before rejecting.
  })
  return () => {
    authListeners.delete(listener)
  }
}

export async function signIn() {
  const instance = await initialize()
  if (!instance) throw new Error('VITE_MS_CLIENT_ID is not configured')
  const result = await instance.loginPopup({ scopes, prompt: 'select_account' })
  instance.setActiveAccount(result.account)
  publishAuth({ ready: true, account: result.account })
  return result.account
}

export async function signOut() {
  const instance = await initialize()
  const account = await currentAccount()
  if (instance && account) await instance.logoutPopup({ account })
  publishAuth({ ready: true })
}

async function token(account: AccountInfo) {
  const instance = await initialize()
  if (!instance) throw new Error('MSAL is not configured')
  try {
    return (await instance.acquireTokenSilent({ account, scopes })).accessToken
  } catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error
    return (await instance.acquireTokenPopup({ account, scopes })).accessToken
  }
}

async function localDocument(): Promise<SyncDocument> {
  return {
    version: 1,
    updatedAt: nowIso(),
    events: await db.events.toArray(),
    occurrences: await db.occurrences.toArray()
  }
}

interface DriveItemMetadata {
  id: string
  eTag: string
}

async function readRemote(accessToken: string): Promise<RemoteSnapshot | undefined> {
  const response = await fetch(`${itemUrl}?$select=id,eTag`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`OneDrive metadata download failed (${response.status}): ${await response.text()}`)
  const metadata = await response.json() as DriveItemMetadata
  if (!metadata.id || !metadata.eTag) throw new Error('OneDrive sync file metadata is missing its ID or ETag')
  const contentResponse = await fetch(fileUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!contentResponse.ok) throw new Error(`OneDrive download failed (${contentResponse.status}): ${await contentResponse.text()}`)
  return {
    document: await contentResponse.json() as SyncDocument,
    identity: { id: metadata.id, eTag: metadata.eTag }
  }
}

async function writeRemote(accessToken: string, document: SyncDocument, expected: RemoteIdentity | undefined) {
  const response = await fetch(expected
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(expected.id)}/content`
    : fileUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...uploadConditionHeaders(expected)
    },
    body: JSON.stringify(document)
  })
  if (response.status === 412 || (!expected && response.status === 409)) throw new PreconditionFailedError()
  if (!response.ok) throw new Error(`OneDrive upload failed (${response.status}): ${await response.text()}`)
}

export interface SuccessfulSync {
  accountId: string
  completedAt: string
}

let activeSync: Promise<SuccessfulSync | undefined> | undefined

export function synchronize() {
  if (activeSync) return activeSync
  activeSync = (async () => {
    if (!navigator.onLine) throw new Error('Offline')
    const account = await currentAccount()
    if (!account) return
    const accessToken = await token(account)
    return withDataOperationLock(async () => {
      const result = await synchronizeWithRetries({
        readLocal: localDocument,
        readRemote: () => readRemote(accessToken),
        persistLocal: async (document) => {
          await db.transaction('rw', db.events, db.occurrences, async () => {
            await db.events.bulkPut(document.events)
            await db.occurrences.bulkPut(document.occurrences)
          })
        },
        writeRemote: (document, expected) => writeRemote(accessToken, document, expected),
        now: nowIso
      })
      await db.syncMeta.put({
        key: syncMetaKey(account.homeAccountId),
        accountId: account.homeAccountId,
        lastSyncedAt: result.completedAt
      })
      return { accountId: account.homeAccountId, completedAt: result.completedAt }
    })
  })().finally(() => { activeSync = undefined })
  return activeSync
}
