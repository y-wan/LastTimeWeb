import {
  BrowserCacheLocation, InteractionRequiredAuthError, PublicClientApplication,
  type AccountInfo, type Configuration
} from '@azure/msal-browser'
import { db, nowIso } from './db'
import { mergeDocuments } from './sync'
import type { SyncDocument } from './types'

const clientId = import.meta.env.VITE_MS_CLIENT_ID as string | undefined
const authority = (import.meta.env.VITE_MS_AUTHORITY as string | undefined) || 'https://login.microsoftonline.com/common'
const scopes = ['Files.ReadWrite.AppFolder']
const fileUrl = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/last-time-data.json:/content'

let msal: PublicClientApplication | undefined
let initialized = false

function getMsal() {
  if (!clientId) return undefined
  if (!msal) {
    const config: Configuration = {
      auth: { clientId, authority, redirectUri: window.location.href.split(/[?#]/)[0] },
      cache: { cacheLocation: BrowserCacheLocation.LocalStorage }
    }
    msal = new PublicClientApplication(config)
  }
  return msal
}

async function initialize() {
  const instance = getMsal()
  if (instance && !initialized) {
    await instance.initialize()
    const result = await instance.handleRedirectPromise()
    if (result?.account) instance.setActiveAccount(result.account)
    initialized = true
  }
  return instance
}

export function isSyncConfigured() {
  return Boolean(clientId)
}

export async function currentAccount() {
  const instance = await initialize()
  return instance?.getActiveAccount() ?? instance?.getAllAccounts()[0]
}

export async function signIn() {
  const instance = await initialize()
  if (!instance) throw new Error('VITE_MS_CLIENT_ID is not configured')
  const result = await instance.loginPopup({ scopes, prompt: 'select_account' })
  instance.setActiveAccount(result.account)
  return result.account
}

export async function signOut() {
  const instance = await initialize()
  const account = await currentAccount()
  if (instance && account) await instance.logoutPopup({ account })
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

async function readRemote(accessToken: string): Promise<SyncDocument | undefined> {
  const response = await fetch(fileUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`OneDrive download failed (${response.status}): ${await response.text()}`)
  return response.json() as Promise<SyncDocument>
}

async function writeRemote(accessToken: string, document: SyncDocument) {
  const response = await fetch(fileUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(document)
  })
  if (!response.ok) throw new Error(`OneDrive upload failed (${response.status}): ${await response.text()}`)
}

let activeSync: Promise<void> | undefined

export function synchronize() {
  if (activeSync) return activeSync
  activeSync = (async () => {
    if (!navigator.onLine) throw new Error('Offline')
    const account = await currentAccount()
    if (!account) return
    const accessToken = await token(account)
    const local = await localDocument()
    const remote = await readRemote(accessToken)
    const merged = remote ? mergeDocuments(local, remote) : local
    await db.transaction('rw', db.events, db.occurrences, async () => {
      await db.events.bulkPut(merged.events)
      await db.occurrences.bulkPut(merged.occurrences)
    })
    await writeRemote(accessToken, { ...merged, updatedAt: nowIso() })
    await db.syncMeta.put({ key: 'sync', lastSyncedAt: nowIso() })
  })().finally(() => { activeSync = undefined })
  return activeSync
}
