import { BrowserCacheLocation, BrowserPerformanceClient, InteractionRequiredAuthError, PublicClientApplication, type Configuration } from '@azure/msal-browser'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_STARTUP_PENDING_KEY,
  AUTH_STARTUP_REPORT_KEY,
  AuthStartupDiagnostics,
  clearAuthStartupDiagnostics
} from '../authStartupDiagnostics'

function fixture() {
  let time = 1000
  const values = new Map<string, string>()
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) })
  }
  const environment = {
    storage: () => storage,
    cookie: () => 'other=private-cookie; msal.cache.encryption=private-key',
    now: () => time
  }
  return {
    values, storage, environment,
    advance: (duration: number) => { time += duration },
    trace: () => new AuthStartupDiagnostics('1.0.10', environment)
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('device-local startup diagnostics', () => {
  it('records only cookie presence and leaves unavailable metrics unknown', () => {
    const test = fixture()
    const report = JSON.parse(test.trace().finish('disconnected'))
    expect(report).toMatchObject({
      msalKeyCookieAtStart: true,
      cachedAccountBeforeRedirectHandling: null,
      cacheCounts: { encrypted: null, expiredEncrypted: null, unencrypted: null },
      silentMethod: null, silentFailure: null, persistence: 'available'
    })
    expect(JSON.stringify(report)).not.toContain('private')
    expect(test.values.size).toBe(1)
  })

  it('takes cookie presence before MSAL can create a new key', () => {
    const test = fixture()
    test.environment.cookie = () => ''
    const trace = test.trace()
    test.environment.cookie = () => 'msal.cache.encryption=new-key'
    expect(JSON.parse(trace.finish('connected')).msalKeyCookieAtStart).toBe(false)
  })

  it('selects only valid initialization counters, never full performance events', () => {
    const test = fixture()
    const trace = test.trace()
    trace.recordPerformance([
      {
        name: 'initializeClientApplication', encryptedCacheCount: 4, encryptedCacheExpiredCount: 2,
        unencryptedCacheCount: 0, accountId: 'private-account', correlationId: 'private-correlation',
        authority: 'private-authority', errorMessage: 'private-error', accessToken: 'private-token'
      },
      { name: 'acquireTokenSilent', encryptedCacheCount: 99 },
      { name: 'initializeClientApplication', encryptedCacheCount: 'private-token', unencryptedCacheCount: -1 },
      null
    ])
    const report = trace.finish('connected')
    expect(JSON.parse(report).cacheCounts).toEqual({ encrypted: 4, expiredEncrypted: 2, unencrypted: 0 })
    expect(report).not.toContain('private')
    expect(report).not.toContain('99')
  })

  it('observes an expired encryption key through the installed MSAL client, without network or raw artifacts', async () => {
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('BroadcastChannel', class extends EventTarget {
      postMessage = vi.fn()
      close = vi.fn()
    })
    localStorage.clear()
    document.cookie = 'msal.cache.encryption=; Max-Age=0; path=/'
    localStorage.setItem('msal.2.account.keys', JSON.stringify(['expired-test-account']))
    localStorage.setItem('expired-test-account', JSON.stringify({
      id: 'private-old-key', nonce: 'private-nonce', data: 'private-encrypted-artifact', lastUpdatedAt: Date.now()
    }))
    const networkClient = {
      sendGetRequestAsync: vi.fn().mockRejectedValue(new Error('Unexpected network request')),
      sendPostRequestAsync: vi.fn().mockRejectedValue(new Error('Unexpected network request'))
    }
    const config: Configuration = {
      auth: { clientId: '00000000-0000-0000-0000-000000000010' },
      cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
      system: { allowPlatformBroker: false, networkClient }
    }
    const client = new PublicClientApplication({
      ...config, telemetry: { client: new BrowserPerformanceClient(config) }
    })
    const trace = new AuthStartupDiagnostics('1.0.10')
    const observedFields: string[][] = []
    const callback = client.addPerformanceCallback((events) => {
      observedFields.push(...events.map((event) => Object.keys(event)))
      trace.recordPerformance(events)
    })
    try {
      await trace.measure('initialize', () => client.initialize())
      trace.recordCachedAccount(client.getAllAccounts().length > 0)
      expect(localStorage.getItem('expired-test-account')).toBeNull()
      expect(observedFields).toContainEqual(expect.arrayContaining(['encryptedCacheExpiredCount']))
      const serialized = trace.finish('disconnected')
      expect(JSON.parse(serialized)).toMatchObject({
        msalKeyCookieAtStart: false, cachedAccountBeforeRedirectHandling: false,
        cacheCounts: { expiredEncrypted: 1 }
      })
      expect(serialized).not.toContain('private')
      expect(serialized).not.toContain('expired-test-account')
      expect(networkClient.sendGetRequestAsync).not.toHaveBeenCalled()
      expect(networkClient.sendPostRequestAsync).not.toHaveBeenCalled()
    } finally {
      client.removePerformanceCallback(callback)
      await client.clearCache()
      localStorage.clear()
      document.cookie = 'msal.cache.encryption=; Max-Age=0; path=/'
    }
  })

  it.each([
    ['interaction_required', 'interaction_required'],
    ['login_required', 'login_required'],
    ['consent_required', 'consent_required'],
    ['post_request_failed', 'network_error'],
    ['get_request_failed', 'network_error'],
    ['no_network_connectivity', 'network_error'],
    ['monitor_window_timeout', 'timeout'],
    ['timed_out', 'timeout'],
    ['private-person@example.com', 'other']
  ])('projects %s to the fixed failure category %s and rethrows the original error', async (code, expected) => {
    const test = fixture()
    const trace = test.trace()
    const failure = { errorCode: code, message: 'private-error', accessToken: 'private-token' }
    await expect(trace.measure('silent', async () => {
      test.advance(12)
      throw failure
    }, 'ssoSilent')).rejects.toBe(failure)
    const report = trace.finish('reconnect-required')
    expect(JSON.parse(report)).toMatchObject({ silentMethod: 'ssoSilent', silentFailure: expected, stagesMs: { silent: 12 } })
    expect(report).not.toContain('private')
  })

  it('preserves the pre-navigation failure across a confirmed return without exposing timestamps', async () => {
    const test = fixture()
    test.environment.cookie = () => ''
    const first = test.trace()
    first.recordCachedAccount(false)
    await expect(first.measure('silent', async () => {
      test.advance(6)
      throw new InteractionRequiredAuthError('interaction_required', 'private-error')
    }, 'ssoSilent')).rejects.toBeInstanceOf(InteractionRequiredAuthError)
    first.beforeNavigation()
    first.finish('pending')
    expect(test.values.has(AUTH_STARTUP_REPORT_KEY)).toBe(false)

    test.advance(2000)
    test.environment.cookie = () => 'msal.cache.encryption=private-key'
    const callback = test.trace()
    await callback.measure('initialize', async () => { test.advance(17) })
    callback.recordCachedAccount(true)
    callback.confirmAutomaticReturn()
    await callback.measure('silent', async () => { test.advance(8) }, 'acquireTokenSilent')
    const serialized = callback.finish('connected')
    expect(JSON.parse(serialized)).toMatchObject({
      automaticRedirect: 'returned', outcome: 'connected',
      msalKeyCookieAtStart: true,
      stagesMs: { initialize: 17, silent: 8, redirectRoundTrip: 2000, returnedAuthProcessing: 25 },
      beforeRedirect: {
        msalKeyCookieAtStart: false, cachedAccountBeforeRedirectHandling: false,
        silentFailure: 'interaction_required', stagesMs: { silent: 6 }
      }
    })
    expect(serialized).not.toContain('navigationAt')
    expect(serialized).not.toContain('private')
    expect(test.values.has(AUTH_STARTUP_PENDING_KEY)).toBe(false)
  })

  it('does not associate pending data with an unconfirmed callback', () => {
    const test = fixture()
    test.trace().beforeNavigation()
    const report = JSON.parse(test.trace().finish('reconnect-required'))
    expect(report.automaticRedirect).toBe('not-attempted')
    expect(report.beforeRedirect).toBeUndefined()
    expect(test.values.has(AUTH_STARTUP_PENDING_KEY)).toBe(true)
  })

  it('reports a confirmed return with unknown duration if the pending record is missing', () => {
    const trace = fixture().trace()
    trace.confirmAutomaticReturn()
    expect(JSON.parse(trace.finish('connected'))).toMatchObject({
      automaticRedirect: 'returned', stagesMs: { redirectRoundTrip: null }
    })
  })

  it.each([-1, 24 * 60 * 60 * 1000 + 1])('marks abnormal round-trip duration %s unknown, not zero', (duration) => {
    const test = fixture()
    test.trace().beforeNavigation()
    test.advance(duration)
    const callback = test.trace()
    callback.confirmAutomaticReturn()
    expect(JSON.parse(callback.finish('connected')).stagesMs.redirectRoundTrip).toBeNull()
    expect(console.warn).toHaveBeenCalled()
  })

  it('keeps a stage unknown after clock reversal even if a later call succeeds', async () => {
    const test = fixture()
    const trace = test.trace()
    await trace.measure('silent', async () => { test.advance(-10) }, 'ssoSilent')
    await trace.measure('silent', async () => { test.advance(10) }, 'acquireTokenSilent')
    expect(JSON.parse(trace.finish('connected')).stagesMs.silent).toBeNull()
  })

  it('accepts the accumulated duration limit and keeps subsequent overflow unknown', async () => {
    const test = fixture()
    const trace = test.trace()
    const halfDay = 12 * 60 * 60 * 1000
    await trace.measure('silent', async () => { test.advance(halfDay) }, 'ssoSilent')
    await trace.measure('silent', async () => { test.advance(halfDay) }, 'acquireTokenSilent')
    expect(JSON.parse(trace.finish('connected')).stagesMs.silent).toBe(halfDay * 2)
    await trace.measure('silent', async () => { test.advance(1) }, 'acquireTokenSilent')
    await trace.measure('silent', async () => { test.advance(1) }, 'acquireTokenSilent')
    expect(JSON.parse(trace.finish('connected')).stagesMs.silent).toBeNull()
    expect(console.warn).toHaveBeenCalledWith('Accumulated startup diagnostic duration is unavailable.')
  })

  it('removes cancelled pending diagnostics without touching authentication storage', () => {
    const test = fixture()
    test.values.set('msal-private-cache', 'private-token')
    const trace = test.trace()
    trace.beforeNavigation()
    trace.cancelNavigation()
    expect(JSON.parse(trace.finish('reconnect-required')).automaticRedirect).toBe('cancelled')
    expect(test.values.has(AUTH_STARTUP_PENDING_KEY)).toBe(false)
    expect(test.values.get('msal-private-cache')).toBe('private-token')
  })

  it('bounds retained data to a latest report and pending report', () => {
    const test = fixture()
    for (let index = 0; index < 20; index++) {
      test.trace().finish('connected')
      test.trace().beforeNavigation()
    }
    expect([...test.values.keys()].sort()).toEqual([AUTH_STARTUP_PENDING_KEY, AUTH_STARTUP_REPORT_KEY].sort())
    clearAuthStartupDiagnostics(true, test.environment.storage)
    expect(test.values.has(AUTH_STARTUP_REPORT_KEY)).toBe(true)
    clearAuthStartupDiagnostics(false, test.environment.storage)
    expect(test.values.size).toBe(0)
  })

  it('reprojects a stored pending record instead of copying extra secret fields', () => {
    const test = fixture()
    test.trace().beforeNavigation()
    const pending = JSON.parse(test.values.get(AUTH_STARTUP_PENDING_KEY)!)
    pending.report.accessToken = 'private-token'
    pending.report.cookie = 'private-cookie'
    pending.report.beforeRedirect = { accountId: 'private-account' }
    pending.report.cacheCounts.extra = 'private-extra'
    test.values.set(AUTH_STARTUP_PENDING_KEY, JSON.stringify(pending))
    const trace = test.trace()
    trace.confirmAutomaticReturn()
    expect(trace.finish('connected')).not.toContain('private')
  })

  it.each(['{invalid', JSON.stringify({ navigationAt: 1000, report: { accessToken: 'private-token' } }), 'x'.repeat(20_001)])(
    'discards malformed pending storage with an explicit, sanitized warning', (serialized) => {
      const test = fixture()
      test.values.set(AUTH_STARTUP_PENDING_KEY, serialized)
      const report = test.trace().finish('connected')
      expect(test.values.has(AUTH_STARTUP_PENDING_KEY)).toBe(false)
      expect(report).not.toContain('private')
      expect(console.warn).toHaveBeenCalledWith('Invalid pending startup diagnostics were discarded.')
    }
  )

  it('reports unavailable persistence and cookie access without blocking authorization operations', async () => {
    const test = fixture()
    test.environment.storage = () => { throw new Error('private-storage-error') }
    test.environment.cookie = () => { throw new Error('private-cookie-error') }
    const trace = test.trace()
    await expect(trace.measure('silent', async () => 'authorized', 'acquireTokenSilent')).resolves.toBe('authorized')
    trace.beforeNavigation()
    trace.confirmAutomaticReturn()
    const report = trace.finish('connected')
    expect(JSON.parse(report)).toMatchObject({ outcome: 'connected', msalKeyCookieAtStart: null, persistence: 'unavailable' })
    expect(report).not.toContain('private')
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private')
  })
})
