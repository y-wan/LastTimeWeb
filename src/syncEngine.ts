import { canonicalStringify, mergeDocuments } from './sync'
import type { SyncDocument } from './types'

export interface RemoteIdentity {
  id: string
  eTag: string
}

export interface RemoteSnapshot {
  document: SyncDocument
  identity: RemoteIdentity
}

export function uploadConditionHeaders(expected: RemoteIdentity | undefined) {
  const headers: Record<string, string> = expected
    ? { 'If-Match': expected.eTag }
    : { 'If-None-Match': '*' }
  return headers
}

export class PreconditionFailedError extends Error {
  constructor() {
    super('The OneDrive sync file changed before upload completed')
    this.name = 'PreconditionFailedError'
  }
}

export class SyncRetryExhaustedError extends Error {
  constructor(attempts: number) {
    super(`OneDrive changed during sync ${attempts} times. Sync stopped safely; try again.`)
    this.name = 'SyncRetryExhaustedError'
  }
}

export function documentsHaveSameRecords(left: SyncDocument, right: SyncDocument) {
  return canonicalStringify({
    events: [...left.events].sort((a, b) => a.id.localeCompare(b.id)),
    occurrences: [...left.occurrences].sort((a, b) => a.id.localeCompare(b.id))
  }) === canonicalStringify({
    events: [...right.events].sort((a, b) => a.id.localeCompare(b.id)),
    occurrences: [...right.occurrences].sort((a, b) => a.id.localeCompare(b.id))
  })
}

interface SyncEngineOptions {
  readLocal: () => Promise<SyncDocument>
  readRemote: () => Promise<RemoteSnapshot | undefined>
  persistLocal: (document: SyncDocument) => Promise<void>
  writeRemote: (document: SyncDocument, expected: RemoteIdentity | undefined) => Promise<void>
  now?: () => string
  maxAttempts?: number
}

export async function synchronizeWithRetries({
  readLocal,
  readRemote,
  persistLocal,
  writeRemote,
  now = () => new Date().toISOString(),
  maxAttempts = 3
}: SyncEngineOptions) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remote = await readRemote()
    const local = await readLocal()
    const merged = remote ? mergeDocuments(local, remote.document) : local
    await persistLocal(merged)
    const completedAt = now()
    if (remote && documentsHaveSameRecords(merged, remote.document)) {
      return { completedAt, document: remote.document, attempts: attempt, uploaded: false }
    }
    const upload = { ...merged, updatedAt: completedAt }
    try {
      await writeRemote(upload, remote?.identity)
      return { completedAt, document: upload, attempts: attempt, uploaded: true }
    } catch (error) {
      if (!(error instanceof PreconditionFailedError)) throw error
      if (attempt === maxAttempts) throw new SyncRetryExhaustedError(maxAttempts)
    }
  }
  throw new SyncRetryExhaustedError(maxAttempts)
}
