import { PerformanceEvents } from '@azure/msal-browser'
import {
  AUTH_STARTUP_BASELINE_KEY,
  observeAuthCache,
  projectAuthCacheEvidence,
  projectSuccessfulAuthBaseline,
  type AuthCacheEvidence
} from './authCacheEvidence'

export const AUTH_STARTUP_REPORT_KEY = 'last-time-auth-startup-report'
export const AUTH_STARTUP_PENDING_KEY = 'last-time-auth-startup-pending'

const MAX_DURATION_MS = 24 * 60 * 60 * 1000
const OUTCOMES = ['pending', 'connected', 'reconnect-required', 'restore-failed', 'error', 'disconnected'] as const
const REDIRECTS = ['not-attempted', 'started', 'returned', 'cancelled'] as const
const SILENT_METHODS = ['acquireTokenSilent', 'ssoSilent'] as const
const FAILURES = ['interaction_required', 'login_required', 'consent_required', 'network_error', 'timeout', 'other'] as const
const RECOVERY_SKIP_REASONS = [
  'silent-error-not-interactive', 'offline', 'startup-not-requested',
  'not-initial-startup', 'initially-hidden', 'initially-offline',
  'currently-hidden', 'currently-offline', 'user-interaction',
  'visibility-hidden', 'visibility-visible', 'page-hidden',
  'connectivity-changed', 'startup-ineligible', 'redirect-result-present',
  'previous-attempt', 'missing-login-hint', 'guard-claim-denied',
  'recovery-start-failed', 'redirect-callback-error',
  'missing-recovery-state', 'account-mismatch', 'startup-error'
] as const

export type RecoverySkipReason = typeof RECOVERY_SKIP_REASONS[number]
type SilentMethod = typeof SILENT_METHODS[number]
type SilentFailure = typeof FAILURES[number]
type TimingStage = 'initialize' | 'redirectResult' | 'silent'
type DiagnosticStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AuthStartupReport {
  schema: 1
  appVersion: string
  msalKeyCookieAtStart: boolean | null
  cachedAccountBeforeRedirectHandling: boolean | null
  usableAccountCountAfterRedirectHandling: number | null
  cacheEvidence: AuthCacheEvidence | null
  cacheCounts: {
    encrypted: number | null
    expiredEncrypted: number | null
    unencrypted: number | null
  }
  silentMethod: SilentMethod | null
  silentFailure: SilentFailure | null
  automaticRedirect: typeof REDIRECTS[number]
  automaticRecoverySkipReason: RecoverySkipReason | null
  outcome: typeof OUTCOMES[number]
  stagesMs: {
    initialize: number | null
    redirectResult: number | null
    silent: number | null
    redirectRoundTrip: number | null
    returnedAuthProcessing: number | null
  }
  persistence: 'available' | 'unavailable'
}

interface DiagnosticEnvironment {
  storage: () => DiagnosticStorage
  cookie: () => string
  now: () => number
}

const browserEnvironment: DiagnosticEnvironment = {
  storage: () => localStorage,
  cookie: () => document.cookie,
  now: () => Date.now()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isChoice<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.some((choice) => choice === value)
}

function isFlag(value: unknown): value is boolean | null {
  return typeof value === 'boolean' || value === null
}

function isMetric(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_DURATION_MS)
}

function projectReport(value: unknown): AuthStartupReport | undefined {
  const skipReason = isRecord(value) ? value.automaticRecoverySkipReason ?? null : null
  if (skipReason !== null && !isChoice(skipReason, RECOVERY_SKIP_REASONS)) return undefined
  const usableAccountCount = isRecord(value) ? value.usableAccountCountAfterRedirectHandling ?? null : null
  if (!isMetric(usableAccountCount)) return undefined
  const cacheEvidence = isRecord(value) && value.cacheEvidence != null
    ? projectAuthCacheEvidence(value.cacheEvidence) : null
  if (cacheEvidence === undefined) return undefined
  if (!isRecord(value) || value.schema !== 1 ||
    typeof value.appVersion !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value.appVersion) ||
    !isFlag(value.msalKeyCookieAtStart) || !isFlag(value.cachedAccountBeforeRedirectHandling) ||
    !isRecord(value.cacheCounts) || !isRecord(value.stagesMs) ||
    !(value.silentMethod === null || isChoice(value.silentMethod, SILENT_METHODS)) ||
    !(value.silentFailure === null || isChoice(value.silentFailure, FAILURES)) ||
    !isChoice(value.automaticRedirect, REDIRECTS) || !isChoice(value.outcome, OUTCOMES) ||
    !isChoice(value.persistence, ['available', 'unavailable'] as const)) return undefined
  const counts = value.cacheCounts
  const stages = value.stagesMs
  if (!isMetric(counts.encrypted) || !isMetric(counts.expiredEncrypted) || !isMetric(counts.unencrypted) ||
    !isMetric(stages.initialize) || !isMetric(stages.redirectResult) || !isMetric(stages.silent) ||
    !isMetric(stages.redirectRoundTrip) || !isMetric(stages.returnedAuthProcessing)) return undefined
  return {
    schema: 1,
    appVersion: value.appVersion,
    msalKeyCookieAtStart: value.msalKeyCookieAtStart,
    cachedAccountBeforeRedirectHandling: value.cachedAccountBeforeRedirectHandling,
    usableAccountCountAfterRedirectHandling: usableAccountCount,
    cacheEvidence,
    cacheCounts: { encrypted: counts.encrypted, expiredEncrypted: counts.expiredEncrypted, unencrypted: counts.unencrypted },
    silentMethod: value.silentMethod,
    silentFailure: value.silentFailure,
    automaticRedirect: value.automaticRedirect,
    automaticRecoverySkipReason: skipReason,
    outcome: value.outcome,
    stagesMs: {
      initialize: stages.initialize, redirectResult: stages.redirectResult, silent: stages.silent,
      redirectRoundTrip: stages.redirectRoundTrip, returnedAuthProcessing: stages.returnedAuthProcessing
    },
    persistence: value.persistence
  }
}

function failureCode(error: unknown): SilentFailure {
  if (!isRecord(error) || typeof error.errorCode !== 'string') return 'other'
  const code = error.errorCode
  if (isChoice(code, ['interaction_required', 'login_required', 'consent_required'] as const)) return code
  if (['no_network_connectivity', 'post_request_failed', 'get_request_failed'].includes(code)) return 'network_error'
  if (['monitor_window_timeout', 'timed_out'].includes(code)) return 'timeout'
  return 'other'
}

export function clearAuthStartupDiagnostics(pendingOnly = false, storage: () => DiagnosticStorage = browserEnvironment.storage) {
  try {
    const target = storage()
    target.removeItem(AUTH_STARTUP_PENDING_KEY)
    if (!pendingOnly) {
      target.removeItem(AUTH_STARTUP_REPORT_KEY)
      target.removeItem(AUTH_STARTUP_BASELINE_KEY)
    }
  } catch {
    console.warn('Unable to clear local startup diagnostics.')
  }
}

export class AuthStartupDiagnostics {
  private readonly report: AuthStartupReport
  private readonly startedAt: number | null
  private readonly invalidStages = new Set<TimingStage>()
  private pending?: { navigationAt: number; report: AuthStartupReport }
  private beforeRedirect?: AuthStartupReport
  private silentSucceeded = false

  constructor(appVersion: string, private readonly environment: DiagnosticEnvironment = browserEnvironment) {
    this.report = {
      schema: 1, appVersion,
      msalKeyCookieAtStart: null, cachedAccountBeforeRedirectHandling: null,
      usableAccountCountAfterRedirectHandling: null,
      cacheEvidence: { lastSuccessfulAuth: null, beforeInitialize: null, afterInitialize: null },
      cacheCounts: { encrypted: null, expiredEncrypted: null, unencrypted: null },
      silentMethod: null, silentFailure: null, automaticRedirect: 'not-attempted', outcome: 'pending',
      automaticRecoverySkipReason: null,
      stagesMs: { initialize: null, redirectResult: null, silent: null, redirectRoundTrip: null, returnedAuthProcessing: null },
      persistence: 'available'
    }
    this.startedAt = this.timestamp()
    try {
      this.report.msalKeyCookieAtStart = this.environment.cookie().split(';')
        .some((cookie) => cookie.trimStart().startsWith('msal.cache.encryption='))
    } catch {
      console.warn('Unable to read MSAL startup cookie presence.')
    }
    this.readPending()
    this.readSuccessfulBaseline()
  }

  private readSuccessfulBaseline() {
    let serialized: string | null
    try {
      serialized = this.environment.storage().getItem(AUTH_STARTUP_BASELINE_KEY)
    } catch {
      this.report.persistence = 'unavailable'
      console.warn('Unable to read the local successful authorization baseline.')
      return
    }
    if (serialized === null) return
    let value: unknown
    try {
      if (serialized.length > 20_000) throw new Error('Oversized authorization baseline')
      value = JSON.parse(serialized)
    } catch {
      console.warn('Invalid successful authorization baseline was discarded.')
      this.store(AUTH_STARTUP_BASELINE_KEY)
      return
    }
    const baseline = projectSuccessfulAuthBaseline(value)
    if (!baseline) {
      console.warn('Invalid successful authorization baseline was discarded.')
      this.store(AUTH_STARTUP_BASELINE_KEY)
      return
    }
    if (this.report.cacheEvidence) this.report.cacheEvidence.lastSuccessfulAuth = baseline
  }

  recordCacheEvidence(stage: 'beforeInitialize' | 'afterInitialize') {
    if (this.report.cacheEvidence) this.report.cacheEvidence[stage] = observeAuthCache(this.environment)
  }

  recordUsableAccountCount(count: number) {
    if (!isMetric(count)) {
      console.warn('The usable MSAL account count is unavailable.')
      return
    }
    this.report.usableAccountCountAfterRedirectHandling = count
  }

  private timestamp() {
    try {
      const value = this.environment.now()
      if (Number.isFinite(value) && value >= 0) return value
    } catch {
      console.warn('Unable to read the startup diagnostic clock.')
      return null
    }
    console.warn('The startup diagnostic clock is invalid.')
    return null
  }

  private elapsed(start: number | null, end = this.timestamp()) {
    if (start !== null && end !== null && end >= start && end - start <= MAX_DURATION_MS) {
      return Math.round(end - start)
    }
    console.warn('Startup diagnostic duration is unavailable.')
    return null
  }

  private store(key: string, value?: string) {
    try {
      const storage = this.environment.storage()
      if (value === undefined) storage.removeItem(key)
      else storage.setItem(key, value)
    } catch {
      this.report.persistence = 'unavailable'
      console.warn('Unable to persist local startup diagnostics.')
    }
  }

  private readPending() {
    let serialized: string | null
    try {
      serialized = this.environment.storage().getItem(AUTH_STARTUP_PENDING_KEY)
    } catch {
      this.report.persistence = 'unavailable'
      console.warn('Unable to read local startup diagnostics.')
      return
    }
    if (serialized === null) return
    let value: unknown
    try {
      if (serialized.length > 20_000) throw new Error('Oversized startup diagnostics')
      value = JSON.parse(serialized)
    } catch {
      console.warn('Invalid pending startup diagnostics were discarded.')
      this.store(AUTH_STARTUP_PENDING_KEY)
      return
    }
    const report = isRecord(value) ? projectReport(value.report) : undefined
    if (!isRecord(value) || typeof value.navigationAt !== 'number' ||
      !Number.isFinite(value.navigationAt) || value.navigationAt < 0 ||
      report?.automaticRedirect !== 'started' || report.outcome !== 'pending') {
      console.warn('Invalid pending startup diagnostics were discarded.')
      this.store(AUTH_STARTUP_PENDING_KEY)
      return
    }
    this.pending = { navigationAt: value.navigationAt, report }
  }

  recordCachedAccount(present: boolean) {
    this.report.cachedAccountBeforeRedirectHandling = present
  }

  recordRecoverySkip(reason: RecoverySkipReason) {
    if (!isChoice(reason, RECOVERY_SKIP_REASONS)) {
      console.warn('Unrecognized automatic recovery skip reason was discarded.')
      return
    }
    this.report.automaticRecoverySkipReason ??= reason
  }

  recordPerformance(events: readonly unknown[]) {
    for (const event of events) {
      if (!isRecord(event) || event.name !== PerformanceEvents.InitializeClientApplication) continue
      for (const [field, target] of [
        ['encryptedCacheCount', 'encrypted'],
        ['encryptedCacheExpiredCount', 'expiredEncrypted'],
        ['unencryptedCacheCount', 'unencrypted']
      ] as const) {
        const value = event[field]
        if (typeof value === 'number' && isMetric(value)) this.report.cacheCounts[target] = value
      }
    }
  }

  async measure<T>(stage: TimingStage, operation: () => Promise<T>, method?: SilentMethod): Promise<T> {
    const startedAt = this.timestamp()
    if (method) this.report.silentMethod = method
    try {
      const result = await operation()
      if (stage === 'silent') this.silentSucceeded = true
      return result
    } catch (error) {
      if (stage === 'silent') {
        this.silentSucceeded = false
        this.report.silentFailure = failureCode(error)
      }
      throw error
    } finally {
      const duration = this.elapsed(startedAt)
      const total = (this.report.stagesMs[stage] ?? 0) + (duration ?? 0)
      if (total > MAX_DURATION_MS) console.warn('Accumulated startup diagnostic duration is unavailable.')
      if (duration === null || total > MAX_DURATION_MS) this.invalidStages.add(stage)
      this.report.stagesMs[stage] = this.invalidStages.has(stage)
        ? null : total
    }
  }

  confirmAutomaticReturn() {
    this.report.automaticRedirect = 'returned'
    if (this.pending) {
      this.beforeRedirect = this.pending.report
      this.report.stagesMs.redirectRoundTrip = this.elapsed(this.pending.navigationAt, this.startedAt)
    }
    this.store(AUTH_STARTUP_PENDING_KEY)
  }

  beforeNavigation() {
    this.report.automaticRedirect = 'started'
    const navigationAt = this.timestamp()
    if (navigationAt !== null) {
      this.store(AUTH_STARTUP_PENDING_KEY, JSON.stringify({ navigationAt, report: this.report }))
    }
  }

  cancelNavigation() {
    this.report.automaticRedirect = 'cancelled'
    this.store(AUTH_STARTUP_PENDING_KEY)
  }

  finish(outcome: AuthStartupReport['outcome']) {
    this.report.outcome = outcome
    if (outcome === 'connected' && this.silentSucceeded) {
      this.store(AUTH_STARTUP_BASELINE_KEY, JSON.stringify({
        schema: 1,
        appVersion: this.report.appVersion,
        cache: observeAuthCache(this.environment)
      }))
    }
    if (this.report.automaticRedirect === 'returned') {
      this.report.stagesMs.returnedAuthProcessing = this.elapsed(this.startedAt)
    }
    const serialize = () => JSON.stringify({
      ...this.report, ...(this.beforeRedirect ? { beforeRedirect: this.beforeRedirect } : {})
    }, null, 2)
    if (outcome !== 'pending') this.store(AUTH_STARTUP_REPORT_KEY, serialize())
    return serialize()
  }
}
