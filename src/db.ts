import Dexie, { type EntityTable } from 'dexie'
import { withDataOperationLock } from './operationLock'
import type {
  EventRecord,
  MicrosoftAuthStateRecord,
  OccurrenceRecord,
  PendingOccurrenceDeletionRecord,
  SettingsRecord,
  SyncMetaRecord
} from './types'

export const db = new Dexie('last-time') as Dexie & {
  events: EntityTable<EventRecord, 'id'>
  occurrences: EntityTable<OccurrenceRecord, 'id'>
  settings: EntityTable<SettingsRecord, 'key'>
  syncMeta: EntityTable<SyncMetaRecord, 'key'>
  microsoftAuthState: EntityTable<MicrosoftAuthStateRecord, 'key'>
  pendingOccurrenceDeletions: EntityTable<PendingOccurrenceDeletionRecord, 'occurrenceId'>
}

db.version(1).stores({
  events: 'id, updatedAt, deletedAt',
  occurrences: 'id, eventId, occurredAt, updatedAt, deletedAt',
  settings: 'key',
  syncMeta: 'key'
})

db.version(2).stores({
  events: 'id, updatedAt, deletedAt',
  occurrences: 'id, eventId, occurredAt, updatedAt, deletedAt',
  settings: 'key',
  syncMeta: 'key',
  microsoftAuthState: 'key'
})

db.version(3).stores({
  events: 'id, updatedAt, deletedAt',
  occurrences: 'id, eventId, occurredAt, updatedAt, deletedAt',
  settings: 'key',
  syncMeta: 'key',
  microsoftAuthState: 'key',
  pendingOccurrenceDeletions: 'occurrenceId, requestedAt'
})

export const nowIso = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()

export function readMicrosoftAuthState() {
  return db.microsoftAuthState.get('microsoft')
}

export function rememberMicrosoftConnection(loginHint?: string) {
  const normalizedHint = loginHint?.trim()
  return db.microsoftAuthState.put({
    key: 'microsoft',
    connectedBefore: true,
    ...(normalizedHint ? { loginHint: normalizedHint } : {})
  })
}

export function forgetMicrosoftConnection() {
  return db.microsoftAuthState.delete('microsoft')
}

export async function createEvent(input: Pick<EventRecord, 'name' | 'note' | 'icon' | 'color'>) {
  return withDataOperationLock(async () => {
    const now = nowIso()
    const record: EventRecord = { id: newId(), ...input, createdAt: now, updatedAt: now }
    await db.events.add(record)
    return record
  })
}

export async function updateEvent(id: string, changes: Partial<Pick<EventRecord, 'name' | 'note' | 'icon' | 'color'>>) {
  await withDataOperationLock(() => db.events.update(id, { ...changes, updatedAt: nowIso() }).then(() => undefined))
}

export async function deleteEvent(id: string) {
  await withDataOperationLock(async () => {
    const now = nowIso()
    await db.transaction('rw', db.events, db.occurrences, async () => {
      await db.events.update(id, { deletedAt: now, updatedAt: now })
      const occurrences = await db.occurrences.where('eventId').equals(id).toArray()
      await Promise.all(occurrences.map((item) => db.occurrences.update(item.id, { deletedAt: now, updatedAt: now })))
    })
  })
}

export async function addOccurrence(eventId: string, occurredAt = nowIso(), note = '') {
  if (new Date(occurredAt).getTime() > Date.now()) throw new Error('Future occurrence timestamps are not allowed')
  return withDataOperationLock(async () => {
    const now = nowIso()
    const record: OccurrenceRecord = { id: newId(), eventId, occurredAt, note, createdAt: now, updatedAt: now }
    await db.occurrences.add(record)
    return record
  })
}

export async function updateOccurrence(id: string, occurredAt: string, note: string) {
  if (new Date(occurredAt).getTime() > Date.now()) throw new Error('Future occurrence timestamps are not allowed')
  await withDataOperationLock(() => db.occurrences.update(id, { occurredAt, note, updatedAt: nowIso() }).then(() => undefined))
}

export async function deleteOccurrence(id: string) {
  await withDataOperationLock(async () => {
    const now = nowIso()
    await db.occurrences.update(id, { deletedAt: now, updatedAt: now })
  })
}

export function queueOccurrenceDeletions(occurrenceIds: string[]) {
  const requestedAt = nowIso()
  return db.transaction('rw', db.pendingOccurrenceDeletions, () =>
    db.pendingOccurrenceDeletions.bulkPut(
      occurrenceIds.map((occurrenceId) => ({ occurrenceId, requestedAt }))
    )
  )
}

export function cancelPendingOccurrenceDeletion(occurrenceId: string) {
  return db.pendingOccurrenceDeletions.delete(occurrenceId)
}

export async function applyPendingOccurrenceDeletion(occurrenceId: string) {
  await withDataOperationLock(async () => {
    const now = nowIso()
    await db.transaction('rw', db.occurrences, db.pendingOccurrenceDeletions, async () => {
      await db.occurrences.update(occurrenceId, { deletedAt: now, updatedAt: now })
      await db.pendingOccurrenceDeletions.delete(occurrenceId)
    })
  })
}

export async function importRecords(events: EventRecord[], occurrences: OccurrenceRecord[]) {
  await withDataOperationLock(async () => {
    await db.transaction('rw', db.events, db.occurrences, async () => {
      await db.events.bulkPut(events)
      await db.occurrences.bulkPut(occurrences)
    })
  })
}

export async function tombstoneAllData(timestamp = nowIso()) {
  return withDataOperationLock(async () => db.transaction(
    'rw',
    db.events,
    db.occurrences,
    db.pendingOccurrenceDeletions,
    async () => {
      const events = await db.events.filter((event) => !event.deletedAt).toArray()
      const occurrences = await db.occurrences.filter((occurrence) => !occurrence.deletedAt).toArray()
      await Promise.all([
        ...events.map((event) => db.events.update(event.id, { deletedAt: timestamp, updatedAt: timestamp })),
        ...occurrences.map((occurrence) => db.occurrences.update(occurrence.id, { deletedAt: timestamp, updatedAt: timestamp })),
        db.pendingOccurrenceDeletions.clear()
      ])
      return { events: events.length, occurrences: occurrences.length, timestamp }
    }
  ))
}
