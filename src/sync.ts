import type { EventRecord, OccurrenceRecord, SyncDocument } from './types'

type SyncRecord = EventRecord | OccurrenceRecord

function winner<T extends SyncRecord>(left: T, right: T) {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right
  return JSON.stringify(left) >= JSON.stringify(right) ? left : right
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
