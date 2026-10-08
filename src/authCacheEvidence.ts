import { version as msalVersion } from '@azure/msal-browser'

export const AUTH_STARTUP_BASELINE_KEY = 'last-time-auth-startup-baseline'

const STATES = ['absent', 'recognized', 'unknown', 'unavailable'] as const
const MAX_REFERENCES = 100
const MAX_INDEX_LENGTH = 20_000
const MAX_ENTRY_LENGTH = 64_000
const MAX_TOTAL_ENTRY_LENGTH = 256_000
const COUNT_FIELDS = [
  'accountReferences', 'presentEntries', 'missingEntries', 'encryptedEntries',
  'matchingKeyEntries', 'differentKeyEntries', 'unrecognizedEntries'
] as const

export interface AuthCacheSnapshot {
  cookieState: typeof STATES[number]
  accountIndexState: typeof STATES[number]
  legacyAccountIndexPresent: boolean | null
  accountReferences: number | null
  presentEntries: number | null
  missingEntries: number | null
  encryptedEntries: number | null
  matchingKeyEntries: number | null
  differentKeyEntries: number | null
  unrecognizedEntries: number | null
}

export interface SuccessfulAuthBaseline {
  schema: 1
  appVersion: string
  cache: AuthCacheSnapshot
}

export interface AuthCacheEvidence {
  lastSuccessfulAuth: SuccessfulAuthBaseline | null
  beforeInitialize: AuthCacheSnapshot | null
  afterInitialize: AuthCacheSnapshot | null
}

interface CacheEnvironment {
  storage: () => Pick<Storage, 'getItem'>
  cookie: () => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isState(value: unknown): value is AuthCacheSnapshot['cookieState'] {
  return STATES.some((state) => state === value)
}

function isCount(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) &&
    value >= 0 && value <= MAX_REFERENCES)
}

function unknownSnapshot(): AuthCacheSnapshot {
  return {
    cookieState: 'unknown', accountIndexState: 'unknown', legacyAccountIndexPresent: null,
    accountReferences: null, presentEntries: null, missingEntries: null, encryptedEntries: null,
    matchingKeyEntries: null, differentKeyEntries: null, unrecognizedEntries: null
  }
}

function projectSnapshot(value: unknown): AuthCacheSnapshot | undefined {
  if (!isRecord(value) || !isState(value.cookieState) || !isState(value.accountIndexState) ||
    !(value.legacyAccountIndexPresent === null || typeof value.legacyAccountIndexPresent === 'boolean') ||
    !COUNT_FIELDS.every((field) => isCount(value[field]))) return undefined
  const result = unknownSnapshot()
  result.cookieState = value.cookieState
  result.accountIndexState = value.accountIndexState
  result.legacyAccountIndexPresent = value.legacyAccountIndexPresent
  for (const field of COUNT_FIELDS) {
    const count = value[field]
    if (isCount(count)) result[field] = count
  }
  return result
}

export function projectSuccessfulAuthBaseline(value: unknown): SuccessfulAuthBaseline | undefined {
  if (!isRecord(value) || value.schema !== 1 || typeof value.appVersion !== 'string' ||
    !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value.appVersion)) return undefined
  const cache = projectSnapshot(value.cache)
  return cache ? { schema: 1, appVersion: value.appVersion, cache } : undefined
}

export function projectAuthCacheEvidence(value: unknown): AuthCacheEvidence | undefined {
  if (!isRecord(value)) return undefined
  const lastSuccessfulAuth = value.lastSuccessfulAuth === null
    ? null : projectSuccessfulAuthBaseline(value.lastSuccessfulAuth)
  const beforeInitialize = value.beforeInitialize === null ? null : projectSnapshot(value.beforeInitialize)
  const afterInitialize = value.afterInitialize === null ? null : projectSnapshot(value.afterInitialize)
  if (lastSuccessfulAuth === undefined || beforeInitialize === undefined || afterInitialize === undefined) return undefined
  return { lastSuccessfulAuth, beforeInitialize, afterInitialize }
}

export function observeAuthCache(environment: CacheEnvironment, sdkVersion = msalVersion): AuthCacheSnapshot {
  const result = unknownSnapshot()
  if (sdkVersion !== '4.30.0') {
    console.warn('The MSAL cache evidence format is unsupported.')
    return result
  }

  let cookieId: string | undefined
  let cookies: string | undefined
  try {
    cookies = environment.cookie()
  } catch {
    result.cookieState = 'unavailable'
    console.warn('Unable to observe MSAL cache cookie metadata.')
  }
  if (cookies !== undefined) {
    const cookie = cookies.split(';').map((item) => item.trim())
      .find((item) => item.startsWith('msal.cache.encryption='))
    if (cookie === undefined) {
      result.cookieState = 'absent'
    } else {
      try {
        const encoded = cookie.slice('msal.cache.encryption='.length)
        if (encoded.length > 4096) throw new Error('Oversized cookie metadata')
        const value: unknown = JSON.parse(decodeURIComponent(encoded))
        if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 512 ||
          typeof value.key !== 'string' || !value.key || value.key.length > 4096) {
          throw new Error('Unrecognized cookie metadata')
        }
        cookieId = value.id
        result.cookieState = 'recognized'
      } catch {
        console.warn('MSAL cache cookie metadata is unrecognized.')
      }
    }
  }

  try {
    const storage = environment.storage()
    result.legacyAccountIndexPresent = storage.getItem('msal.account.keys') !== null ||
      storage.getItem('msal.1.account.keys') !== null
    const index = storage.getItem('msal.2.account.keys')
    let keys: string[] = []
    if (index !== null) {
      let value: unknown
      try {
        if (index.length > MAX_INDEX_LENGTH) throw new Error('Oversized account index')
        value = JSON.parse(index)
      } catch {
        console.warn('MSAL account index metadata is unrecognized.')
        return result
      }
      if (!Array.isArray(value) || value.length > MAX_REFERENCES ||
        !value.every((key): key is string => typeof key === 'string' && key.length > 0 && key.length <= 512) ||
        new Set(value).size !== value.length) {
        console.warn('MSAL account index metadata is unrecognized.')
        return result
      }
      keys = value
    }
    result.accountIndexState = index === null ? 'absent' : 'recognized'
    result.accountReferences = keys.length
    let present = 0
    let missing = 0
    let encrypted = 0
    let matching = 0
    let different = 0
    let unrecognized = 0
    let totalLength = 0
    for (const key of keys) {
      const raw = storage.getItem(key)
      if (raw === null) {
        missing++
        continue
      }
      present++
      totalLength += raw.length
      if (raw.length > MAX_ENTRY_LENGTH || totalLength > MAX_TOTAL_ENTRY_LENGTH) {
        console.warn('MSAL cache metadata exceeds observation limits.')
        return result
      }
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch {
        unrecognized++
        continue
      }
      if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 512 ||
        typeof value.nonce !== 'string' || !value.nonce || typeof value.data !== 'string' || !value.data) {
        unrecognized++
        continue
      }
      encrypted++
      if (cookieId !== undefined) {
        if (value.id === cookieId) matching++
        else different++
      }
    }
    if (unrecognized > 0) console.warn('Some MSAL account entry metadata is unrecognized.')
    result.presentEntries = present
    result.missingEntries = missing
    result.encryptedEntries = encrypted
    result.matchingKeyEntries = cookieId === undefined ? null : matching
    result.differentKeyEntries = cookieId === undefined ? null : different
    result.unrecognizedEntries = unrecognized
  } catch {
    result.accountIndexState = 'unavailable'
    console.warn('Unable to observe MSAL startup cache metadata.')
  }
  return result
}

export function persistSuccessfulAuthBaseline(appVersion: string) {
  try {
    const baseline = projectSuccessfulAuthBaseline({
      schema: 1, appVersion,
      cache: observeAuthCache({ storage: () => localStorage, cookie: () => document.cookie })
    })
    if (!baseline) {
      console.warn('The successful authorization baseline format is invalid.')
      return
    }
    localStorage.setItem(AUTH_STARTUP_BASELINE_KEY, JSON.stringify(baseline))
  } catch {
    console.warn('Unable to persist the local successful authorization baseline.')
  }
}
