import type { EventRecord, OccurrenceRecord } from './types'
import { normalizeEventColor } from './eventOptions'
import { normalizeIconKey } from './iconCatalogue'

const HEADERS = [
  'Event ID', 'Event', 'Event Note', 'Icon', 'Color', 'Event Created', 'Event Updated',
  'Occurrence ID', 'Occurrence', 'Occurrence Created', 'Occurrence Updated', 'Occurrence Note'
]
const EVENT_NAMESPACE = '15075f6d-8f84-4dd4-9dd1-cb64a3176ec0'
const OCCURRENCE_NAMESPACE = '219180e2-7d6b-4b7e-9747-5f9d0301ef44'

function escapeCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

export function exportCsv(events: EventRecord[], occurrences: OccurrenceRecord[]) {
  const rows = [HEADERS.map(escapeCsv).join(',')]
  const activeEvents = events.filter((event) => !event.deletedAt)
  for (const event of activeEvents) {
    const history = occurrences.filter((item) => item.eventId === event.id && !item.deletedAt)
    const entries = history.length ? history : [undefined]
    for (const occurrence of entries) {
      rows.push([
        event.id,
        event.name,
        event.note,
        event.icon,
        event.color,
        event.createdAt,
        event.updatedAt,
        occurrence?.id ?? '',
        occurrence?.occurredAt ?? '',
        occurrence?.createdAt ?? '',
        occurrence?.updatedAt ?? '',
        occurrence?.note ?? ''
      ].map(escapeCsv).join(','))
    }
  }
  return rows.join('\r\n')
}

export function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++ }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const headers = rows.shift()?.map((header) => header.trim()) ?? []
  return rows.filter((item) => item.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']))
  )
}

function normalizeTimestamp(value: string) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function parseLegacyDate(row: Record<string, string>) {
  const occurrence = row.Occurrence || row.occurredAt || row.occurrenceTime
  if (occurrence) return normalizeTimestamp(occurrence)
  const timestamp = row.Timestamp || row.timestamp
  if (timestamp) {
    const numeric = Number(timestamp)
    if (Number.isFinite(numeric)) return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString()
    const parsed = new Date(timestamp)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  const date = row.Date || row.date
  const time = row.Time || row.time
  if (date) {
    const parsed = new Date(`${date}${time ? ` ${time}` : ''}`)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return ''
}

function firstValue(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    if (row[alias]) return row[alias]
  }
  return ''
}

function hasOccurrenceSchema(row: Record<string, string>) {
  return ['Occurrence', 'occurredAt', 'occurrenceTime', 'Timestamp', 'timestamp', 'Date', 'date', 'Time', 'time']
    .some((header) => Object.hasOwn(row, header))
}

function normalizeEventIdentity(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function uuidBytes(uuid: string) {
  return Uint8Array.from(uuid.replaceAll('-', '').match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
}

async function deterministicUuid(namespace: string, value: string) {
  const namespaceBytes = uuidBytes(namespace)
  const valueBytes = new TextEncoder().encode(value)
  const input = new Uint8Array(namespaceBytes.length + valueBytes.length)
  input.set(namespaceBytes)
  input.set(valueBytes, namespaceBytes.length)
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

interface ImportRow {
  row: Record<string, string>
  name: string
  eventId: string
  eventNote: string
  occurrenceNote: string
  occurredAt: string
}

export async function importCsv(text: string, now = new Date()) {
  const rows = parseCsv(text)
  const events = new Map<string, EventRecord>()
  const occurrences = new Map<string, OccurrenceRecord>()
  const importTime = now.toISOString()
  const importRows: ImportRow[] = []

  for (const row of rows) {
    const name = (row.Event || row.Name || row.event || row.title).trim()
    if (!name) continue
    const explicitEventNote = firstValue(row, ['Event Note', 'event_notes', 'event_note', 'eventNote', 'description'])
    const explicitOccurrenceNote = firstValue(row, ['Occurrence Note', 'occurrence_notes', 'occurrence_note', 'occurrenceNote'])
    const genericNote = firstValue(row, ['Note', 'notes'])
    const occurrenceSchema = hasOccurrenceSchema(row)
    const eventNote = explicitEventNote || (!occurrenceSchema ? genericNote : '')
    const occurrenceNote = explicitOccurrenceNote || (occurrenceSchema ? genericNote : '')
    const eventId = firstValue(row, ['Event ID', 'eventId', 'event_id'])
    importRows.push({ row, name, eventId, eventNote, occurrenceNote, occurredAt: parseLegacyDate(row) })
  }

  for (const item of importRows) {
    const { row, name, eventNote, occurredAt } = item
    const normalizedName = normalizeEventIdentity(name)
    const key = item.eventId ? `id:${item.eventId}` : `name:${normalizedName}`
    let event = events.get(key)
    if (!event) {
      const id = item.eventId || await deterministicUuid(EVENT_NAMESPACE, normalizedName)
      const created = normalizeTimestamp(firstValue(row, ['Event Created', 'eventCreatedAt', 'createdAt'])) || occurredAt || importTime
      event = {
        id,
        name,
        note: eventNote,
        icon: normalizeIconKey(row.Icon || row.icon || 'event'),
        color: normalizeEventColor(row.Color || row.color),
        createdAt: created,
        updatedAt: normalizeTimestamp(firstValue(row, ['Event Updated', 'eventUpdatedAt', 'updatedAt'])) || importTime
      }
      events.set(key, event)
    } else if (!event.note && eventNote) {
      event.note = eventNote
    }
  }

  const importedOccurrences = await Promise.all(importRows.map(async (item) => {
    const { row, occurrenceNote, occurredAt } = item
    if (occurredAt && new Date(occurredAt).getTime() <= now.getTime()) {
      const normalizedName = normalizeEventIdentity(item.name)
      const key = item.eventId ? `id:${item.eventId}` : `name:${normalizedName}`
      const event = events.get(key)
      if (!event) return undefined
      const explicitOccurrenceId = firstValue(row, ['Occurrence ID', 'occurrenceId', 'occurrence_id'])
      const occurrenceId = explicitOccurrenceId || await deterministicUuid(OCCURRENCE_NAMESPACE, `${event.id}\0${occurredAt}`)
      return {
        id: occurrenceId,
        eventId: event.id,
        occurredAt,
        note: occurrenceNote,
        createdAt: normalizeTimestamp(firstValue(row, ['Occurrence Created', 'occurrenceCreatedAt'])) || occurredAt,
        updatedAt: normalizeTimestamp(firstValue(row, ['Occurrence Updated', 'occurrenceUpdatedAt'])) || importTime
      } satisfies OccurrenceRecord
    }
    return undefined
  }))
  for (const occurrence of importedOccurrences) {
    if (occurrence) occurrences.set(occurrence.id, occurrence)
  }
  return { events: [...events.values()], occurrences: [...occurrences.values()] }
}
