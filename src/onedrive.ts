import {
  BrowserCacheLocation, InteractionRequiredAuthError, PublicClientApplication,
  type AccountInfo, type Configuration
} from '@azure/msal-browser'
import { resolveCommonAuthority, rootRedirectUri, selectAccount } from './auth'
import {
  initializeMicrosoftSession,
  signInMicrosoft,
  signOutMicrosoft,
  type AuthSnapshot,
  type MicrosoftAuthStateStore
} from './authSession'
import {
  db,
  forgetMicrosoftConnection,
  nowIso,
  readMicrosoftAuthState,
  rememberMicrosoftConnection
} from './db'
import { withDataOperationLock } from './operationLock'
import {
  PreconditionFailedError,
  synchronizeWithRetries,
  uploadConditionHeaders,
  type RemoteIdentity,
  type RemoteSnapshot
} from './syncEngine'
import { syncMetaKey } from './syncStatus'
import { SyncDurationTrace } from './syncTiming'
import type { SyncDocument } from './types'

const clientId = import.meta.env.VITE_MS_CLIENT_ID as string | undefined
const authority = resolveCommonAuthority()
const scopes = ['Files.ReadWrite.AppFolder']
const itemUrl = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/last-time-data.json'
const fileUrl = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/last-time-data.json:/content'

let msal: PublicClientApplication | undefined
let initialization: Promise<PublicClientApplication | undefined> | undefined

export type { AuthSnapshot } from './authSession'

const authStateStore: MicrosoftAuthStateStore = {
  read: readMicrosoftAuthState,
  remember: rememberMicrosoftConnection,
  forget: forgetMicrosoftConnection
}

let authSnapshot: AuthSnapshot = clientId
  ? { ready: false, status: 'checking' }
  : { ready: true, status: 'disconnected' }
const authListeners = new Set<(snapshot: AuthSnapshot) => void>()

function publishAuth(snapshot: AuthSnapshot) {
  authSnapshot = snapshot
  for (const listener of authListeners) listener(snapshot)
}

function isAuthConnected() {
  return authSnapshot.status === 'connected'
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
        const snapshot = await initializeMicrosoftSession({
          client: instance,
          store: authStateStore,
          scopes,
          online: navigator.onLine,
          onRestoring: () => publishAuth({ ready: false, status: 'restoring' })
        })
        publishAuth(snapshot)
        return instance
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        publishAuth({ ready: true, status: 'error', error: message })
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
  if (account && (authSnapshot.account?.homeAccountId !== account.homeAccountId || !authSnapshot.ready)) {
    publishAuth({ ready: true, status: 'connected', account })
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

export async function retryAuthRestore() {
  if (authSnapshot.status !== 'reconnect-required' || !authSnapshot.offline) {
    return authSnapshot.status === 'connected'
  }
  initialization = undefined
  publishAuth({ ready: false, status: 'restoring' })
  try {
    await initialize()
  } catch {
    return false
  }
  return isAuthConnected()
}

export async function signIn() {
  const instance = await initialize()
  if (!instance) throw new Error('VITE_MS_CLIENT_ID is not configured')
  const account = await signInMicrosoft({
    client: instance,
    store: authStateStore,
    scopes,
    reconnecting: authSnapshot.status === 'reconnect-required'
  })
  publishAuth({ ready: true, status: 'connected', account })
  return account
}

export async function signOut() {
  const instance = await initialize()
  const account = await currentAccount()
  let failure: unknown
  try {
    if (instance) await signOutMicrosoft({ client: instance, store: authStateStore, account })
    else await authStateStore.forget()
  } catch (error) {
    failure = error
  }
  publishAuth({ ready: true, status: 'disconnected' })
  if (failure) throw failure
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

export async function localDocument(): Promise<SyncDocument> {
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

async function readRemote(accessToken: string, trace: SyncDurationTrace): Promise<RemoteSnapshot | undefined> {
  const metadata = await trace.measure('remoteMetadata', async () => {
    const response = await fetch(`${itemUrl}?$select=id,eTag`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`OneDrive metadata download failed (${response.status}): ${await response.text()}`)
    const value = await response.json() as DriveItemMetadata
    if (!value.id || !value.eTag) throw new Error('OneDrive sync file metadata is missing its ID or ETag')
    return value
  })
  if (!metadata) return undefined
  const document = await trace.measure('remoteContent', async () => {
    const response = await fetch(fileUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw new Error(`OneDrive download failed (${response.status}): ${await response.text()}`)
    return response.json() as Promise<SyncDocument>
  })
  return {
    document,
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
  const trace = new SyncDurationTrace()
  let diagnostics = {
    outcome: 'success' as 'success' | 'error' | 'skipped',
    attempts: 0,
    uploaded: false,
    documentBytes: 0
  }
  activeSync = (async () => {
    if (!navigator.onLine) throw new Error('Offline')
    const account = await trace.measure('account', currentAccount)
    if (!account) {
      diagnostics.outcome = 'skipped'
      return
    }
    const accessToken = await trace.measure('token', () => token(account))
    const lockRequestedAt = trace.timestamp()
    return withDataOperationLock(async () => {
      trace.addSince('lockWait', lockRequestedAt)
      const result = await synchronizeWithRetries({
        readLocal: () => trace.measure('localRead', localDocument),
        readRemote: () => readRemote(accessToken, trace),
        persistLocal: (document) => trace.measure('localPersist', async () => {
          await db.transaction('rw', db.events, db.occurrences, async () => {
            await db.events.bulkPut(document.events)
            await db.occurrences.bulkPut(document.occurrences)
          })
        }),
        writeRemote: (document, expected) => trace.measure(
          'remoteWrite',
          () => writeRemote(accessToken, document, expected)
        ),
        now: nowIso
      })
      diagnostics = {
        outcome: 'success',
        attempts: result.attempts,
        uploaded: result.uploaded,
        documentBytes: new TextEncoder().encode(JSON.stringify(result.document)).byteLength
      }
      await trace.measure('syncMetaPersist', () => db.syncMeta.put({
        key: syncMetaKey(account.homeAccountId),
        accountId: account.homeAccountId,
        lastSyncedAt: result.completedAt
      }))
      return { accountId: account.homeAccountId, completedAt: result.completedAt }
    })
  })().catch((error) => {
    diagnostics.outcome = 'error'
    throw error
  }).finally(() => {
    console.info('[Last Time sync timing]', trace.summary(diagnostics))
    activeSync = undefined
  })
  return activeSync
}
