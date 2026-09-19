import type { EventRecord, OccurrenceRecord } from './types'
import { normalizeEventColor } from './eventOptions'
import { normalizeIconKey } from './iconCatalogue'

const HEADERS = ['Event', 'Event Note', 'Icon', 'Color', 'Event Created', 'Occurrence', 'Occurrence Note']

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
        event.name,
        event.note,
        event.icon,
        event.color,
        event.createdAt,
        occurrence?.occurredAt ?? '',
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

function parseLegacyDate(row: Record<string, string>) {
  if (row.Occurrence || row.occurredAt || row.occurrenceTime) return row.Occurrence || row.occurredAt || row.occurrenceTime
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

export function importCsv(text: string, now = new Date()) {
  const rows = parseCsv(text)
  const events = new Map<string, EventRecord>()
  const occurrences: OccurrenceRecord[] = []
  for (const row of rows) {
    const name = (row.Event || row.Name || row.event || row.title).trim()
    if (!name) continue
    const explicitEventNote = firstValue(row, ['Event Note', 'event_notes', 'event_note', 'eventNote', 'description'])
    const explicitOccurrenceNote = firstValue(row, ['Occurrence Note', 'occurrence_notes', 'occurrence_note', 'occurrenceNote'])
    const genericNote = firstValue(row, ['Note', 'notes'])
    const occurrenceSchema = hasOccurrenceSchema(row)
    const eventNote = explicitEventNote || (!occurrenceSchema ? genericNote : '')
    const occurrenceNote = explicitOccurrenceNote || (occurrenceSchema ? genericNote : '')
    const key = row.eventId || name
    let event = events.get(key)
    if (!event) {
      const created = row['Event Created'] || row.createdAt || now.toISOString()
      event = {
        id: row.eventId || crypto.randomUUID(),
        name,
        note: eventNote,
        icon: normalizeIconKey(row.Icon || row.icon || 'event'),
        color: normalizeEventColor(row.Color || row.color),
        createdAt: created,
        updatedAt: row.updatedAt || now.toISOString()
      }
      events.set(key, event)
    } else if (!event.note && eventNote) {
      event.note = eventNote
    }
    const occurredAt = parseLegacyDate(row)
    if (occurredAt && new Date(occurredAt).getTime() <= now.getTime()) {
      occurrences.push({
        id: row.occurrenceId || crypto.randomUUID(),
        eventId: event.id,
        occurredAt,
        note: occurrenceNote,
        createdAt: row.occurrenceCreatedAt || occurredAt,
        updatedAt: row.occurrenceUpdatedAt || occurredAt
      })
    }
  }
  return { events: [...events.values()], occurrences }
}
