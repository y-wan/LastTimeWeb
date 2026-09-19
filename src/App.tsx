import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, History, Plus, Search, Settings, Upload, Wifi, WifiOff, X } from 'lucide-react'
import { addOccurrence, createEvent, db, deleteEvent, deleteOccurrence, updateEvent, updateOccurrence } from './db'
import { exportCsv, importCsv } from './csv'
import { formatElapsed, historyGroup, toLocalInputValue } from './date'
import { iconCatalogue } from './iconCatalogue'
import { EventIcon } from './icons'
import { translator } from './i18n'
import { currentAccount, isSyncConfigured, signIn, signOut, synchronize } from './onedrive'
import type { EventRecord, Locale, OccurrenceRecord, SyncState, ThemeMode } from './types'

const COLORS = ['#e66d5b', '#177b78', '#d6973c', '#7656a5', '#4f7d55', '#bf5c82', '#4d79b8', '#8a6547']
const EMPTY_EVENTS: EventRecord[] = []
const EMPTY_OCCURRENCES: OccurrenceRecord[] = []

type EventDraft = Pick<EventRecord, 'name' | 'note' | 'icon' | 'color'>
const emptyDraft: EventDraft = { name: '', note: '', icon: 'clock', color: COLORS[0] }

function useSync(onComplete: () => void) {
  const [state, setState] = useState<SyncState>(navigator.onLine ? 'idle' : 'offline')
  const [error, setError] = useState('')
  const timer = useRef<number | undefined>(undefined)

  const run = useCallback(async () => {
    if (!navigator.onLine) { setState('offline'); return }
    if (!isSyncConfigured() || !(await currentAccount())) { setState('idle'); return }
    setState('syncing')
    setError('')
    try {
      await synchronize()
      setState('idle')
      onComplete()
    } catch (cause) {
      setState(navigator.onLine ? 'error' : 'offline')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onComplete])

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(run, 500)
  }, [run])

  useEffect(() => {
    const online = () => { setState('idle'); void run() }
    const offline = () => setState('offline')
    const visible = () => { if (document.visibilityState === 'visible') void run() }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    void run()
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', visible)
      window.clearTimeout(timer.current)
    }
  }, [run])

  return { state, error, run, schedule }
}

function EventForm({ initial, t, onSave, onClose }: {
  initial?: EventRecord
  t: ReturnType<typeof translator>
  onSave: (draft: EventDraft) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<EventDraft>(initial ?? emptyDraft)
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="sheet" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault()
        void onSave({ ...draft, name: draft.name.trim(), note: draft.note.trim() })
      }}>
        <div className="sheet-header"><h2>{initial ? t('edit') : t('addEvent')}</h2><button type="button" className="icon-button" onClick={onClose}><X /></button></div>
        <label>{t('name')}<input autoFocus required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>{t('note')} <span className="muted">{t('optional')}</span><textarea maxLength={500} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <fieldset><legend>{t('icon')}</legend><div className="icon-grid">
          {iconCatalogue.map((icon) => <button aria-label={icon} className={draft.icon === icon ? 'selected' : ''} type="button" key={icon} onClick={() => setDraft({ ...draft, icon })}><EventIcon name={icon} /></button>)}
        </div></fieldset>
        <fieldset><legend>{t('color')}</legend><div className="color-grid">
          {COLORS.map((color) => <button aria-label={color} className={draft.color === color ? 'selected' : ''} style={{ background: color }} type="button" key={color} onClick={() => setDraft({ ...draft, color })} />)}
        </div></fieldset>
        <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>{t('cancel')}</button><button className="primary" disabled={!draft.name.trim()}>{t('save')}</button></div>
      </form>
    </div>
  )
}

function OccurrenceEditor({ occurrence, t, onSave, onClose }: {
  occurrence?: OccurrenceRecord
  t: ReturnType<typeof translator>
  onSave: (date: string, note: string) => Promise<void>
  onClose: () => void
}) {
  const [date, setDate] = useState(toLocalInputValue(occurrence?.occurredAt ?? new Date().toISOString()))
  const [note, setNote] = useState(occurrence?.note ?? '')
  const max = toLocalInputValue(new Date().toISOString())
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="sheet compact" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault()
        const iso = new Date(date).toISOString()
        if (new Date(iso).getTime() > Date.now()) return
        void onSave(iso, note.trim())
      }}>
        <div className="sheet-header"><h2>{occurrence ? t('edit') : t('addOccurrence')}</h2><button type="button" className="icon-button" onClick={onClose}><X /></button></div>
        <label>{t('occurredAt')}<input type="datetime-local" required max={max} value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>{t('note')} <span className="muted">{t('optional')}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>{t('cancel')}</button><button className="primary" disabled={!date || date > max}>{t('save')}</button></div>
      </form>
    </div>
  )
}

function EventDetail({ event, occurrences, locale, t, onClose, onMutate, onEditEvent }: {
  event: EventRecord
  occurrences: OccurrenceRecord[]
  locale: Locale
  t: ReturnType<typeof translator>
  onClose: () => void
  onMutate: () => void
  onEditEvent: () => void
}) {
  const [editing, setEditing] = useState<OccurrenceRecord | null | 'new'>(null)
  const history = occurrences.filter((item) => item.eventId === event.id && !item.deletedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="sheet detail-sheet" onMouseDown={(click) => click.stopPropagation()}>
        <div className="sheet-header">
          <div className="detail-title"><span className="event-icon" style={{ background: event.color }}><EventIcon name={event.icon} /></span><div><h2>{event.name}</h2>{event.note && <p>{event.note}</p>}</div></div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </div>
        <div className="detail-actions"><button className="secondary" onClick={onEditEvent}>{t('edit')}</button><button className="primary" onClick={() => setEditing('new')}><Plus size={18} />{t('addOccurrence')}</button></div>
        <h3>{t('occurrences')}</h3>
        {!history.length && <p className="empty">{t('noHistory')}</p>}
        <div className="occurrence-list">
          {history.map((item) => <article key={item.id}>
            <button className="occurrence-main" onClick={() => setEditing(item)}>
              <strong>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.occurredAt))}</strong>
              {item.note && <span>{item.note}</span>}
            </button>
            <button className="danger-text" onClick={async () => {
              if (window.confirm(t('confirmDeleteOccurrence'))) { await deleteOccurrence(item.id); onMutate() }
            }}>{t('delete')}</button>
          </article>)}
        </div>
        <button className="danger wide" onClick={async () => {
          if (window.confirm(t('confirmDeleteEvent'))) { await deleteEvent(event.id); onMutate(); onClose() }
        }}>{t('delete')}</button>
      </section>
      {editing && <OccurrenceEditor occurrence={editing === 'new' ? undefined : editing} t={t} onClose={() => setEditing(null)} onSave={async (occurredAt, note) => {
        if (editing === 'new') await addOccurrence(event.id, occurredAt, note)
        else await updateOccurrence(editing.id, occurredAt, note)
        setEditing(null); onMutate()
      }} />}
    </div>
  )
}

export default function App() {
  const events = useLiveQuery(() => db.events.filter((event) => !event.deletedAt).toArray(), []) ?? EMPTY_EVENTS
  const occurrences = useLiveQuery(() => db.occurrences.filter((item) => !item.deletedAt).toArray(), []) ?? EMPTY_OCCURRENCES
  const settings = useLiveQuery(() => db.settings.get('settings'), [])
  const [locale, setLocale] = useState<Locale>(() => (navigator.language.startsWith('zh') ? 'zh-CN' : 'en'))
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [tab, setTab] = useState<'events' | 'history' | 'settings'>('events')
  const [editingEvent, setEditingEvent] = useState<EventRecord | null | 'new'>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [undo, setUndo] = useState<{ id: string; timer: number } | null>(null)
  const [accountName, setAccountName] = useState('')
  const [notice, setNotice] = useState('')
  const t = useMemo(() => translator(locale), [locale])
  const refreshAccount = useCallback(() => { void currentAccount().then((account) => setAccountName(account?.username ?? '')) }, [])
  const sync = useSync(refreshAccount)

  useEffect(() => {
    if (settings) { setLocale(settings.locale); setTheme(settings.theme) }
  }, [settings])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.lang = locale
  }, [theme, locale])
  useEffect(refreshAccount, [refreshAccount])

  const mutate = useCallback(() => sync.schedule(), [sync])
  const latestByEvent = useMemo(() => {
    const map = new Map<string, OccurrenceRecord>()
    for (const item of occurrences) {
      const previous = map.get(item.eventId)
      if (!previous || item.occurredAt > previous.occurredAt) map.set(item.eventId, item)
    }
    return map
  }, [occurrences])
  const filtered = events.filter((event) => `${event.name} ${event.note}`.toLowerCase().includes(query.toLowerCase()))
  const sorted = [...filtered].sort((a, b) => (latestByEvent.get(b.id)?.occurredAt ?? '').localeCompare(latestByEvent.get(a.id)?.occurredAt ?? ''))
  const detailEvent = events.find((event) => event.id === detailId)

  const markNow = async (eventId: string) => {
    const occurrence = await addOccurrence(eventId)
    if (undo) window.clearTimeout(undo.timer)
    const timer = window.setTimeout(() => setUndo(null), 10_000)
    setUndo({ id: occurrence.id, timer })
    mutate()
  }

  const persistSettings = async (nextLocale: Locale, nextTheme: ThemeMode) => {
    setLocale(nextLocale); setTheme(nextTheme)
    await db.settings.put({ key: 'settings', locale: nextLocale, theme: nextTheme })
  }

  const grouped = (['today', 'recent', 'earlier', 'never'] as const).map((group) => ({
    group,
    events: sorted.filter((event) => historyGroup(latestByEvent.get(event.id)?.occurredAt) === group)
  }))

  return (
    <div className="app-shell">
      <header>
        <div><h1>{t('appName')}</h1><p>{t('subtitle')}</p></div>
        <SyncBadge state={sync.state} error={sync.error} t={t} />
      </header>
      <main>
        {tab === 'events' && <>
          <div className="toolbar">
            <label className="search"><Search size={18} /><input aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <button className="primary add-button" onClick={() => setEditingEvent('new')}><Plus />{t('addEvent')}</button>
          </div>
          {!events.length && <div className="empty-state"><EventIcon name="clock" size={48} /><p>{t('empty')}</p><button className="primary" onClick={() => setEditingEvent('new')}>{t('addEvent')}</button></div>}
          <div className="event-grid">
            {sorted.map((event) => {
              const latest = latestByEvent.get(event.id)
              return <article className="event-card" key={event.id}>
                <button className="event-card-main" onClick={() => setDetailId(event.id)}>
                  <span className="event-icon large" style={{ background: event.color }}><EventIcon name={event.icon} size={28} /></span>
                  <span className="event-copy"><strong>{event.name}</strong>{event.note && <small>{event.note}</small>}<b>{formatElapsed(latest?.occurredAt, locale)}</b></span>
                </button>
                <button className="mark-button" onClick={() => void markNow(event.id)}>{t('markNow')}</button>
              </article>
            })}
          </div>
        </>}
        {tab === 'history' && <div className="history-page">
          {grouped.map(({ group, events: groupEvents }) => groupEvents.length > 0 && <section key={group}>
            <h2>{t(group === 'never' ? 'never' : group)}</h2>
            {groupEvents.map((event) => {
              const latest = latestByEvent.get(event.id)
              return <button className="history-row" key={event.id} onClick={() => setDetailId(event.id)}>
                <span className="event-icon" style={{ background: event.color }}><EventIcon name={event.icon} /></span>
                <span><strong>{event.name}</strong><small>{latest ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(latest.occurredAt)) : t('never')}</small></span>
                <b>{formatElapsed(latest?.occurredAt, locale)}</b>
              </button>
            })}
          </section>)}
        </div>}
        {tab === 'settings' && <div className="settings-page">
          <section><h2>{t('language')}</h2><div className="segmented"><button className={locale === 'en' ? 'active' : ''} onClick={() => void persistSettings('en', theme)}>English</button><button className={locale === 'zh-CN' ? 'active' : ''} onClick={() => void persistSettings('zh-CN', theme)}>简体中文</button></div></section>
          <section><h2>{t('appearance')}</h2><div className="segmented">{(['system', 'light', 'dark'] as ThemeMode[]).map((value) => <button className={theme === value ? 'active' : ''} key={value} onClick={() => void persistSettings(locale, value)}>{t(value)}</button>)}</div></section>
          <section><h2>{t('sync')}</h2>
            {!isSyncConfigured() ? <p className="warning">{t('clientIdMissing')}</p> : accountName ? <>
              <p className="connected">{t('signedIn')}<small>{accountName}</small></p>
              <div className="settings-actions"><button className="primary" onClick={() => void sync.run()}>{t('syncNow')}</button><button className="secondary" onClick={async () => { await signOut(); setAccountName('') }}>{t('signOut')}</button></div>
            </> : <button className="primary wide" onClick={async () => { const account = await signIn(); setAccountName(account.username); await sync.run() }}>{t('signIn')}</button>}
            {sync.error && <p className="error-message">{sync.error}</p>}
          </section>
          <section><h2>{t('data')}</h2><div className="settings-actions">
            <label className="button secondary"><Upload size={18} />{t('import')}<input hidden type="file" accept=".csv,text/csv" onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const imported = importCsv(await file.text())
              await db.transaction('rw', db.events, db.occurrences, async () => {
                await db.events.bulkPut(imported.events); await db.occurrences.bulkPut(imported.occurrences)
              })
              setNotice(t('imported')); mutate(); event.target.value = ''
            }} /></label>
            <button className="secondary" onClick={() => {
              const blob = new Blob([exportCsv(events, occurrences)], { type: 'text/csv;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a'); anchor.href = url; anchor.download = `last-time-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click()
              URL.revokeObjectURL(url)
            }}><Download size={18} />{t('export')}</button>
          </div>{notice && <p className="success-message">{notice}</p>}</section>
        </div>}
      </main>
      <nav>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}><EventIcon name="clock" /><span>{t('events')}</span></button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History /><span>{t('history')}</span></button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><Settings /><span>{t('settings')}</span></button>
      </nav>
      {editingEvent && <EventForm initial={editingEvent === 'new' ? undefined : editingEvent} t={t} onClose={() => setEditingEvent(null)} onSave={async (draft) => {
        if (editingEvent === 'new') await createEvent(draft)
        else await updateEvent(editingEvent.id, draft)
        setEditingEvent(null); mutate()
      }} />}
      {detailEvent && <EventDetail event={detailEvent} occurrences={occurrences} locale={locale} t={t} onClose={() => setDetailId(null)} onMutate={mutate} onEditEvent={() => { setDetailId(null); setEditingEvent(detailEvent) }} />}
      {undo && <div className="toast">{t('marked')}<button onClick={async () => { window.clearTimeout(undo.timer); await deleteOccurrence(undo.id); setUndo(null); mutate() }}>{t('undo')}</button></div>}
    </div>
  )
}

function SyncBadge({ state, error, t }: { state: SyncState; error: string; t: ReturnType<typeof translator> }) {
  const label = state === 'offline' ? t('offline') : state === 'syncing' ? t('syncing') : state === 'error' ? t('syncError') : t('synced')
  return <span className={`sync-badge ${state}`} title={error}>{state === 'offline' ? <WifiOff size={14} /> : <Wifi size={14} />}{label}</span>
}
