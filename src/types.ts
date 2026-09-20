export type ThemeMode = 'system' | 'light' | 'dark'
export type Locale = 'en' | 'zh-CN'
export type ColorTheme = 'vitalOrange' | 'mistBlue' | 'sage' | 'softPurple' | 'quietGray'
export type SyncState = 'offline' | 'idle' | 'syncing' | 'error'

export interface EventRecord {
  id: string
  name: string
  note: string
  icon: string
  color: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface OccurrenceRecord {
  id: string
  eventId: string
  occurredAt: string
  note: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface SyncDocument {
  version: 1
  updatedAt: string
  events: EventRecord[]
  occurrences: OccurrenceRecord[]
}

export interface SettingsRecord {
  key: 'settings'
  locale: Locale
  theme: ThemeMode
  colorTheme?: ColorTheme
}

export interface MicrosoftAuthStateRecord {
  key: 'microsoft'
  connectedBefore: true
  loginHint?: string
}

export interface SyncMetaRecord {
  key: string
  accountId: string
  lastSyncedAt?: string
  error?: string
}
