import type { EventRecord, OccurrenceRecord, SyncDocument } from './types'

type SyncRecord = EventRecord | OccurrenceRecord

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  return value
}

export function canonicalStringify(value: unknown) {
  return JSON.stringify(canonicalize(value))
}

function winner<T extends SyncRecord>(left: T, right: T) {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right
  if (Boolean(left.deletedAt) !== Boolean(right.deletedAt)) return left.deletedAt ? left : right
  return canonicalStringify(left) >= canonicalStringify(right) ? left : right
}

export function mergeRecords<T extends SyncRecord>(local: T[], remote: T[]) {
  const merged = new Map<string, T>()
  for (const record of [...local, ...remote]) {
    const existing = merged.get(record.id)
    merged.set(record.id, existing ? winner(existing, record) : record)
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function mergeDocuments(local: SyncDocument, remote: SyncDocument): SyncDocument {
  return {
    version: 1,
    updatedAt: local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt,
    events: mergeRecords(local.events, remote.events),
    occurrences: mergeRecords(local.occurrences, remote.occurrences)
  }
}
