import Dexie, { type EntityTable } from 'dexie'
import { withDataOperationLock } from './operationLock'
import type { EventRecord, OccurrenceRecord, SettingsRecord, SyncMetaRecord } from './types'

export const db = new Dexie('last-time') as Dexie & {
  events: EntityTable<EventRecord, 'id'>
  occurrences: EntityTable<OccurrenceRecord, 'id'>
  settings: EntityTable<SettingsRecord, 'key'>
  syncMeta: EntityTable<SyncMetaRecord, 'key'>
}

db.version(1).stores({
  events: 'id, updatedAt, deletedAt',
  occurrences: 'id, eventId, occurredAt, updatedAt, deletedAt',
  settings: 'key',
  syncMeta: 'key'
})

export const nowIso = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()

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

export async function importRecords(events: EventRecord[], occurrences: OccurrenceRecord[]) {
  await withDataOperationLock(async () => {
    await db.transaction('rw', db.events, db.occurrences, async () => {
      await db.events.bulkPut(events)
      await db.occurrences.bulkPut(occurrences)
    })
  })
}
