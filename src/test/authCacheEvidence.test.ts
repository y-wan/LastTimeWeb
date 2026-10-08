import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeAuthCache, persistSuccessfulAuthBaseline, projectAuthCacheEvidence, projectSuccessfulAuthBaseline } from '../authCacheEvidence'

function fixture() {
  const values = new Map<string, string>([
    ['msal.2.account.keys', JSON.stringify(['private-account-a', 'private-account-b', 'private-missing'])],
    ['private-account-a', JSON.stringify({ id: 'private-current-id', nonce: 'private-nonce', data: 'private-token' })],
    ['private-account-b', JSON.stringify({ id: 'private-other-id', nonce: 'private-nonce', data: 'private-token' })]
  ])
  const getItem = vi.fn((key: string) => values.get(key) ?? null)
  const environment = {
    storage: () => ({ getItem }),
    cookie: () => `other=private-cookie; msal.cache.encryption=${encodeURIComponent(JSON.stringify({
      id: 'private-current-id', key: 'private-key'
    }))}`
  }
  return { values, getItem, environment }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('read-only MSAL cache evidence', () => {
  it('accepts the exact reference, key, index, per-entry and aggregate limits', () => {
    const test = fixture()
    test.values.clear()
    const keys = Array.from({ length: 100 }, (_, i) => i === 0 ? 'x'.repeat(512) : `account-${i}`)
    const index = JSON.stringify(keys)
    test.values.set('msal.2.account.keys', index.padEnd(20_000, ' '))
    const envelope = { id: 'private-current-id', nonce: 'private-nonce', data: '' }
    const raw = JSON.stringify({ ...envelope, data: 'x'.repeat(64_000 - JSON.stringify(envelope).length) })
    expect(raw.length).toBe(64_000)
    for (const key of keys.slice(0, 4)) test.values.set(key, raw)
    expect(observeAuthCache(test.environment)).toMatchObject({
      accountReferences: 100, presentEntries: 4, missingEntries: 96,
      encryptedEntries: 4, matchingKeyEntries: 4, differentKeyEntries: 0
    })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('does not change authorization results when baseline persistence is denied', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private-storage-error') })
    expect(() => persistSuccessfulAuthBaseline('1.0.12')).not.toThrow()
    expect(console.warn).toHaveBeenCalledWith('Unable to persist the local successful authorization baseline.')
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
  })

  it('exports only aggregate metadata and compares IDs only transiently', () => {
    const test = fixture()
    const before = [...test.values.entries()]
    const snapshot = observeAuthCache(test.environment)
    expect(snapshot).toEqual({
      cookieState: 'recognized', accountIndexState: 'recognized', legacyAccountIndexPresent: false,
      accountReferences: 3, presentEntries: 2, missingEntries: 1, encryptedEntries: 2,
      matchingKeyEntries: 1, differentKeyEntries: 1, unrecognizedEntries: 0
    })
    expect([...test.values.entries()]).toEqual(before)
    expect(JSON.stringify(snapshot)).not.toContain('private')
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
  })

  it.each(['', 'msal.cache.encryption=private-invalid', 'msal.cache.encryption=%private-invalid'])(
    'does not infer key mismatch from an absent or unrecognized cookie', (cookie) => {
      const test = fixture()
      test.environment.cookie = () => cookie
      expect(observeAuthCache(test.environment)).toMatchObject({
        cookieState: cookie ? 'unknown' : 'absent',
        encryptedEntries: 2, matchingKeyEntries: null, differentKeyEntries: null
      })
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
    }
  )

  it('reports current-index absence separately from legacy-index presence', () => {
    const test = fixture()
    test.values.delete('msal.2.account.keys')
    test.values.set('msal.1.account.keys', 'private-legacy-data')
    expect(observeAuthCache(test.environment)).toMatchObject({
      accountIndexState: 'absent', legacyAccountIndexPresent: true,
      accountReferences: 0, presentEntries: 0, missingEntries: 0
    })
  })

  it.each([
    '{private-invalid', JSON.stringify({ private: 'secret' }), JSON.stringify(['private-account-a', 'private-account-a']),
    JSON.stringify([17]), JSON.stringify(['x'.repeat(513)]), JSON.stringify(Array.from({ length: 101 }, (_, i) => `private-${i}`)),
    'x'.repeat(20_001)
  ])('keeps malformed or out-of-bounds indices unknown without reading referenced entries', (index) => {
    const test = fixture()
    test.values.set('msal.2.account.keys', index)
    expect(observeAuthCache(test.environment)).toMatchObject({
      accountIndexState: 'unknown', accountReferences: null, presentEntries: null, missingEntries: null
    })
    expect(test.getItem.mock.calls.flat().every((key) => key.startsWith('msal.'))).toBe(true)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
  })

  it.each(['{private-invalid', JSON.stringify({ username: 'private-person@example.com' })])(
    'does not claim an unrecognized entry is a usable or encrypted account', (raw) => {
      const test = fixture()
      test.values.set('private-account-a', raw)
      expect(observeAuthCache(test.environment)).toMatchObject({
        presentEntries: 2, encryptedEntries: 1, matchingKeyEntries: 0, unrecognizedEntries: 1
      })
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
    }
  )

  it('does not publish partial counts after an observation limit is reached', () => {
    const test = fixture()
    test.values.set('private-account-a', 'x'.repeat(64_001))
    expect(observeAuthCache(test.environment)).toMatchObject({
      accountIndexState: 'recognized', accountReferences: 3, presentEntries: null, encryptedEntries: null
    })
    expect(console.warn).toHaveBeenCalledWith('MSAL cache metadata exceeds observation limits.')
  })

  it('enforces the aggregate entry budget as well as the per-entry budget', () => {
    const test = fixture()
    const keys = Array.from({ length: 5 }, (_, i) => `private-large-${i}`)
    test.values.set('msal.2.account.keys', JSON.stringify(keys))
    for (const key of keys) test.values.set(key, 'x'.repeat(60_000))
    expect(observeAuthCache(test.environment)).toMatchObject({ accountReferences: 5, presentEntries: null })
    expect(console.warn).toHaveBeenCalledWith('MSAL cache metadata exceeds observation limits.')
  })

  it('leaves unsupported SDK formats unknown without reading storage or cookies', () => {
    const test = fixture()
    const cookie = vi.fn(test.environment.cookie)
    expect(observeAuthCache({ ...test.environment, cookie }, 'private-unknown-version')).toMatchObject({
      cookieState: 'unknown', accountIndexState: 'unknown', accountReferences: null
    })
    expect(test.getItem).not.toHaveBeenCalled()
    expect(cookie).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
  })

  it('reports denied access without logging raw errors', () => {
    const test = fixture()
    test.environment.storage = () => { throw new Error('private-storage-error') }
    test.environment.cookie = () => { throw new Error('private-cookie-error') }
    expect(observeAuthCache(test.environment)).toMatchObject({
      cookieState: 'unavailable', accountIndexState: 'unavailable', accountReferences: null
    })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
  })

  it('reprojects all persisted evidence and rejects non-allowlisted metadata', () => {
    const cache = { ...observeAuthCache(fixture().environment), id: 'private-id', key: 'private-key' }
    const baseline = { schema: 1, appVersion: '1.0.12', cache, accessToken: 'private-token' }
    const evidence = projectAuthCacheEvidence({
      lastSuccessfulAuth: baseline, beforeInitialize: cache, afterInitialize: cache,
      arbitraryLog: 'private-sdk-log'
    })
    expect(evidence).toBeDefined()
    expect(JSON.stringify(evidence)).not.toContain('private')
    expect(projectSuccessfulAuthBaseline({ ...baseline, cache: { ...cache, cookieState: 'private-cookie' } })).toBeUndefined()
    expect(projectSuccessfulAuthBaseline({ ...baseline, cache: { ...cache, accountReferences: 101 } })).toBeUndefined()
  })
})
