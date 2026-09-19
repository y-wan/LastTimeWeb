import type { SyncMetaRecord, SyncState } from './types'
import type { translator } from './i18n'

export type SyncPresentation = 'checking' | 'deviceOnly' | 'notSynced' | 'syncing' | 'synced' | 'offline' | 'error'

interface SyncStatusInput {
  authReady: boolean
  accountId?: string
  syncState: SyncState
  lastSuccessfulSyncAt?: string
}

export function syncMetaKey(accountId: string) {
  return `sync:${accountId}`
}

export function currentAccountLastSync(accountId: string | undefined, meta: SyncMetaRecord | undefined) {
  return accountId && meta?.accountId === accountId ? meta.lastSyncedAt : undefined
}

export function syncPresentation({
  authReady,
  accountId,
  syncState,
  lastSuccessfulSyncAt
}: SyncStatusInput): SyncPresentation {
  if (!authReady) return 'checking'
  if (!accountId) return 'deviceOnly'
  if (syncState === 'offline') return 'offline'
  if (syncState === 'syncing') return 'syncing'
  if (syncState === 'error') return 'error'
  return lastSuccessfulSyncAt ? 'synced' : 'notSynced'
}

export function syncStatusLabel(status: SyncPresentation, t: ReturnType<typeof translator>) {
  if (status === 'checking') return t('checkingAccount')
  if (status === 'deviceOnly') return t('deviceOnly')
  if (status === 'notSynced') return t('notSyncedYet')
  if (status === 'offline') return t('offlineWaiting')
  if (status === 'syncing') return t('syncing')
  if (status === 'error') return t('syncError')
  return t('synced')
}
