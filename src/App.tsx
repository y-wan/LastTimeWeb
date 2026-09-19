import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addOccurrence, createEvent, db, deleteEvent, deleteOccurrence, importRecords, updateEvent, updateOccurrence } from './db'
import { exportCsv, importCsv } from './csv'
import { averageInterval, formatDuration, formatElapsed, formatInterval, formatSyncDateTime, formatSyncTime, historyGroup, toLocalInputValue } from './date'
import { accountIdentity } from './auth'
import { iconCatalogue, iconLabel } from './iconCatalogue'
import { EventIcon, MaterialIcon, type MaterialIconName } from './icons'
import { translator } from './i18n'
import { currentAccount, isSyncConfigured, signIn, signOut, subscribeAuth, synchronize, type AuthSnapshot } from './onedrive'
import { activatePwaUpdate } from './pwaUpdate'
import { currentAccountLastSync, syncMetaKey, syncPresentation, type SyncPresentation } from './syncStatus'
import type { ColorTheme, EventRecord, Locale, OccurrenceRecord, SyncState, ThemeMode } from './types'
import { updateStore, type UpdateSnapshot } from './updateStore'

const COLORS = ['#e66d5b', '#177b78', '#d6973c', '#7656a5', '#4f7d55', '#bf5c82', '#4d79b8', '#8a6547']
const PALETTES: Array<{ id: ColorTheme; primary: string; secondary: string; background: string; surface: string }> = [
  { id: 'vitalOrange', primary: '#E86F51', secondary: '#238C82', background: '#FFF8F3', surface: '#FFFDFC' },
  { id: 'mistBlue', primary: '#587DB7', secondary: '#4F8997', background: '#F7F9FC', surface: '#FFFFFF' },
  { id: 'sage', primary: '#6F8D68', secondary: '#B46F56', background: '#FAF8F1', surface: '#FFFFFF' },
  { id: 'softPurple', primary: '#8067A8', secondary: '#B2738A', background: '#FAF7FC', surface: '#FFFFFF' },
  { id: 'quietGray', primary: '#586A70', secondary: '#708A82', background: '#F7F6F3', surface: '#FFFFFF' }
]
const EMPTY_EVENTS: EventRecord[] = []
const EMPTY_OCCURRENCES: OccurrenceRecord[] = []

type EventDraft = Pick<EventRecord, 'name' | 'note' | 'icon' | 'color'>
const emptyDraft: EventDraft = { name: '', note: '', icon: 'clock', color: COLORS[0] }

function useSync(accountId?: string) {
  const [state, setState] = useState<SyncState>(navigator.onLine ? 'idle' : 'offline')
  const [error, setError] = useState('')
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<{ accountId: string; completedAt: string }>()
  const timer = useRef<number | undefined>(undefined)

  const run = useCallback(async () => {
    if (!navigator.onLine) { setState('offline'); return }
    try {
      if (!isSyncConfigured() || !(await currentAccount())) { setState('idle'); return }
      setState('syncing')
      setError('')
      const completedAt = await synchronize()
      setState('idle')
      if (completedAt) setLastSuccessfulSync(completedAt)
    } catch (cause) {
      setState(navigator.onLine ? 'error' : 'offline')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    setError('')
    setState(navigator.onLine ? 'idle' : 'offline')
    setLastSuccessfulSync((current) => current?.accountId === accountId ? current : undefined)
  }, [accountId])

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

  return { state, error, lastSuccessfulSync, run, schedule }
}

function EventForm({ initial, locale, t, onSave, onClose, onDirtyChange }: {
  initial?: EventRecord
  locale: Locale
  t: ReturnType<typeof translator>
  onSave: (draft: EventDraft) => Promise<void>
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const original: EventDraft = initial
    ? { name: initial.name, note: initial.note, icon: initial.icon, color: initial.color }
    : emptyDraft
  const [draft, setDraft] = useState<EventDraft>(original)
  const dirty = JSON.stringify(draft) !== JSON.stringify(original)
  const requestClose = () => {
    if (!dirty || window.confirm(t('discardChanges'))) onClose()
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  return (
    <div className="modal-backdrop" onMouseDown={requestClose}>
      <form className="sheet" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault()
        void onSave({ ...draft, name: draft.name.trim(), note: draft.note.trim() })
      }}>
        <div className="editor-header">
          <button type="button" className="icon-button" aria-label={t('back')} onClick={requestClose}><MaterialIcon name="back" /></button>
          <h2>{initial ? t('edit') : t('addEvent')}</h2>
          <button className="text-button" disabled={!draft.name.trim()}>{t('saveEvent')}</button>
        </div>
        <label>{t('name')}<input autoFocus required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>{t('note')} <span className="muted">{t('optional')}</span><textarea maxLength={500} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <fieldset><legend>{t('chooseIcon')}</legend><div className="icon-grid">
          {iconCatalogue.map((icon) => <button aria-label={iconLabel(icon, locale)} className={draft.icon === icon ? 'selected' : ''} type="button" key={icon} onClick={() => setDraft({ ...draft, icon })}><EventIcon name={icon} size={30} /><span>{iconLabel(icon, locale)}</span></button>)}
        </div></fieldset>
        <fieldset><legend>{t('chooseColor')}</legend><div className="color-grid">
          {COLORS.map((color) => <button aria-label={color} className={draft.color === color ? 'selected' : ''} style={{ background: color }} type="button" key={color} onClick={() => setDraft({ ...draft, color })}>{draft.color === color && <MaterialIcon name="check" size={20} />}</button>)}
        </div></fieldset>
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
  const initial = toLocalInputValue(occurrence?.occurredAt ?? new Date().toISOString())
  const [date, setDate] = useState(initial.slice(0, 10))
  const [time, setTime] = useState(initial.slice(11, 16))
  const [note, setNote] = useState(occurrence?.note ?? '')
  const max = toLocalInputValue(new Date().toISOString())
  const occurredAt = date && time ? new Date(`${date}T${time}`).toISOString() : ''
  const isFuture = occurredAt ? new Date(occurredAt).getTime() > Date.now() : false
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="sheet compact" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault()
        if (!occurredAt || isFuture) return
        void onSave(occurredAt, note.trim())
      }}>
        <div className="editor-header"><button type="button" className="icon-button" aria-label={t('back')} onClick={onClose}><MaterialIcon name="back" /></button><h2>{occurrence ? t('edit') : t('addOccurrence')}</h2><button className="text-button" disabled={!occurredAt || isFuture}>{t('save')}</button></div>
        <div className="date-time-grid">
          <label>{t('occurredAt')}<input type="date" required max={max.slice(0, 10)} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>{t('time')}<input type="time" required max={date === max.slice(0, 10) ? max.slice(11, 16) : undefined} value={time} onChange={(event) => setTime(event.target.value)} /></label>
        </div>
        <label>{t('note')} <span className="muted">{t('optional')}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {isFuture && <p className="error-message">{t('futureError')}</p>}
      </form>
    </div>
  )
}

function EventDetail({ event, occurrences, locale, t, onClose, onMutate, onEditEvent, onMarkNow }: {
  event: EventRecord
  occurrences: OccurrenceRecord[]
  locale: Locale
  t: ReturnType<typeof translator>
  onClose: () => void
  onMutate: () => void
  onEditEvent: () => void
  onMarkNow?: (eventId: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<OccurrenceRecord | null | 'new'>(null)
  const history = occurrences.filter((item) => item.eventId === event.id && !item.deletedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  const average = averageInterval(history.map((item) => item.occurredAt))
  const predicted = average && history[0] ? new Date(new Date(history[0].occurredAt).getTime() + average) : undefined
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="sheet detail-sheet" onMouseDown={(click) => click.stopPropagation()}>
        <div className="detail-header">
          <button className="icon-button" aria-label={t('back')} onClick={onClose}><MaterialIcon name="back" /></button>
          <h2>{event.name}</h2>
          <div>
            <button className="icon-button" aria-label={t('edit')} onClick={onEditEvent}><MaterialIcon name="edit" size={20} /></button>
            <button className="icon-button danger-icon" aria-label={t('delete')} onClick={async () => {
              if (window.confirm(t('confirmDeleteEvent'))) { await deleteEvent(event.id); onMutate(); onClose() }
            }}><MaterialIcon name="delete" size={20} /></button>
          </div>
        </div>
        <div className="detail-event-icon" style={{ '--event-color': event.color } as CSSProperties}><EventIcon name={event.icon} size={34} /></div>
        <div className="detail-actions">
          <button className="primary" onClick={() => void onMarkNow?.(event.id)}><MaterialIcon name="check" size={20} />{t('markNow')}</button>
          <button className="secondary" onClick={() => setEditing('new')}><MaterialIcon name="event" size={20} />{t('addOccurrence')}</button>
        </div>
        <section className="stats-card">
          <h3>{t('statistics')}</h3>
          {average && predicted ? <div className="stats-grid">
            <div><small>{t('averageInterval')}</small><strong>{formatDuration(average, locale)}</strong></div>
            <div><small>{t('predictedNext')}</small><strong>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(predicted)}</strong></div>
          </div> : <p>{t('insufficientData')}</p>}
        </section>
        {event.note && <section className="notes-card"><h3>{t('eventNotes')}</h3><p>{event.note}</p></section>}
        <div className="section-heading"><h3>{t('occurrences')}</h3><span>{history.length}</span></div>
        {!history.length && <p className="empty">{t('noHistory')}</p>}
        <div className="occurrence-list">
          {history.map((item, index) => <article key={item.id}>
            <span className="history-icon"><EventIcon name="clock" size={20} /></span>
            <button className="occurrence-main" onClick={() => setEditing(item)}>
              <strong>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.occurredAt))}</strong>
              {history[index + 1] && <small>{t('sincePrevious')}: {formatInterval(history[index + 1].occurredAt, item.occurredAt, locale)}</small>}
              {item.note && <span>{item.note}</span>}
            </button>
            <button className="icon-button danger-icon" aria-label={t('deleteRecord')} onClick={async () => {
              if (window.confirm(t('confirmDeleteOccurrence'))) { await deleteOccurrence(item.id); onMutate() }
            }}><MaterialIcon name="delete" size={18} /></button>
          </article>)}
        </div>
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
  const [colorTheme, setColorTheme] = useState<ColorTheme>('vitalOrange')
  const [tab, setTab] = useState<'events' | 'settings'>('events')
  const [editingEvent, setEditingEvent] = useState<EventRecord | null | 'new'>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [undo, setUndo] = useState<{ id: string; timer: number } | null>(null)
  const [auth, setAuth] = useState<AuthSnapshot>({ ready: !isSyncConfigured() })
  const [notice, setNotice] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [update, setUpdate] = useState<UpdateSnapshot>({ available: false, applying: false })
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const overlayHistoryActive = useRef(false)
  const allowOverlayClose = useRef(false)
  const t = useMemo(() => translator(locale), [locale])
  const accountId = auth.account?.homeAccountId
  const syncMeta = useLiveQuery(() => accountId ? db.syncMeta.get(syncMetaKey(accountId)) : undefined, [accountId])
  const lastSuccessfulSyncAt = currentAccountLastSync(accountId, syncMeta)
  const sync = useSync(accountId)
  const syncStatus = syncPresentation({
    authReady: auth.ready,
    accountId,
    syncState: sync.state,
    lastSuccessfulSyncAt
  })

  useEffect(() => {
    if (settings) { setLocale(settings.locale); setTheme(settings.theme); setColorTheme(settings.colorTheme ?? 'vitalOrange') }
  }, [settings])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.palette = colorTheme
    document.documentElement.lang = locale
    const palette = PALETTES.find((item) => item.id === colorTheme) ?? PALETTES[0]
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', palette.primary)
  }, [colorTheme, theme, locale])
  useEffect(() => subscribeAuth(setAuth), [])
  useEffect(() => updateStore.subscribe((snapshot) => {
    setUpdate(snapshot)
    if (snapshot.available && !snapshot.error) setUpdateDismissed(false)
  }), [])
  const overlayOpen = Boolean(editingEvent || detailId)
  useEffect(() => {
    if (overlayOpen && !overlayHistoryActive.current) {
      window.history.pushState({ lastTimeOverlay: true }, '')
      overlayHistoryActive.current = true
    }
  }, [overlayOpen])
  useEffect(() => {
    const onPopState = () => {
      if (!overlayHistoryActive.current) return
      if (!allowOverlayClose.current && editorDirty && !window.confirm(t('discardChanges'))) {
        window.history.pushState({ lastTimeOverlay: true }, '')
        return
      }
      allowOverlayClose.current = false
      overlayHistoryActive.current = false
      setEditingEvent(null)
      setDetailId(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [editorDirty, t])
  useEffect(() => {
    if (!sync.lastSuccessfulSync || sync.lastSuccessfulSync.accountId !== accountId) {
      setSyncNotice('')
      return
    }
    setSyncNotice(`${t('syncSucceeded')} · ${formatSyncTime(sync.lastSuccessfulSync.completedAt, locale)}`)
    const timer = window.setTimeout(() => setSyncNotice(''), 4_000)
    return () => window.clearTimeout(timer)
  }, [accountId, locale, sync.lastSuccessfulSync, t])

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
  const identity = auth.account ? accountIdentity(auth.account) : undefined
  const updateMessage = update.errorKind === 'timeout'
    ? t('updateTimeout')
    : update.error
      ? `${t('updateFailed')} ${update.error}`
      : t('updateAvailable')

  const markNow = async (eventId: string) => {
    const occurrence = await addOccurrence(eventId)
    if (undo) window.clearTimeout(undo.timer)
    const timer = window.setTimeout(() => setUndo(null), 10_000)
    setUndo({ id: occurrence.id, timer })
    mutate()
  }

  const closeOverlay = () => {
    allowOverlayClose.current = true
    if (overlayHistoryActive.current) window.history.back()
    else {
      setEditingEvent(null)
      setDetailId(null)
    }
  }

  const persistSettings = async (nextLocale: Locale, nextTheme: ThemeMode, nextColorTheme: ColorTheme) => {
    setLocale(nextLocale); setTheme(nextTheme); setColorTheme(nextColorTheme)
    await db.settings.put({ key: 'settings', locale: nextLocale, theme: nextTheme, colorTheme: nextColorTheme })
  }

  const connectMicrosoft = async () => {
    try {
      await signIn()
      await sync.run()
    } catch (cause) {
      setAuth({ ready: true, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const disconnectMicrosoft = async () => {
    try {
      await signOut()
    } catch (cause) {
      setAuth((current) => ({ ...current, ready: true, error: cause instanceof Error ? cause.message : String(cause) }))
    }
  }

  const grouped = (['today', 'recent', 'earlier', 'never'] as const).map((group) => ({
    group,
    events: sorted.filter((event) => historyGroup(latestByEvent.get(event.id)?.occurredAt) === group)
  }))

  return (
    <div className="app-shell">
      <header>
        <div><h1>{t('appName')}</h1><p>{t('subtitle')}</p></div>
        <div className="sync-control">
          <SyncBadge status={syncStatus} error={auth.error || sync.error} t={t} />
          {syncStatus === 'deviceOnly' && isSyncConfigured() && <button className="sync-cta" onClick={() => void connectMicrosoft()}>{t('signIn')}</button>}
        </div>
      </header>
      <main>
        {tab === 'events' && <>
          <div className="toolbar">
            <label className="search"><MaterialIcon name="search" size={18} /><input aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          </div>
          {!events.length && <div className="empty-state"><span className="empty-icon"><EventIcon name="clock" size={34} /></span><h2>{t('emptyTitle')}</h2><p>{t('empty')}</p><button className="primary" onClick={() => setEditingEvent('new')}><MaterialIcon name="add" size={20} />{t('addEvent')}</button></div>}
          <div className="grouped-events">
            {grouped.map(({ group, events: groupEvents }) => groupEvents.length > 0 && <section key={group}>
              <h2>{t(group === 'never' ? 'never' : group)}</h2>
              <div className="event-grid">
                {groupEvents.map((event) => {
                  const latest = latestByEvent.get(event.id)
                  const eventStyle = { '--event-color': event.color } as CSSProperties
                  return <article className="event-card" style={eventStyle} key={event.id}>
                    <button className="event-card-main" onClick={() => setDetailId(event.id)}>
                      <span className="event-icon"><EventIcon name={event.icon} size={24} /></span>
                      <span className="event-copy"><strong>{event.name}</strong>{event.note && <small>{event.note}</small>}<b>{formatElapsed(latest?.occurredAt, locale)}</b></span>
                    </button>
                    <button className="record-button" aria-label={`${t('record')} ${event.name}`} onClick={() => void markNow(event.id)}><span><MaterialIcon name="check" size={20} /></span></button>
                  </article>
                })}
              </div>
            </section>)}
          </div>
          <button className="fab" aria-label={t('addEvent')} onClick={() => setEditingEvent('new')}><MaterialIcon name="add" size={26} /></button>
        </>}
        {tab === 'settings' && <div className="settings-page">
          <section className="settings-card"><h2>{t('language')}</h2><div className="segmented"><button className={locale === 'en' ? 'active' : ''} onClick={() => void persistSettings('en', theme, colorTheme)}>English</button><button className={locale === 'zh-CN' ? 'active' : ''} onClick={() => void persistSettings('zh-CN', theme, colorTheme)}>简体中文</button></div></section>
          <section className="settings-card"><h2>{t('appearance')}</h2><div className="segmented">{(['system', 'light', 'dark'] as ThemeMode[]).map((value) => <button className={theme === value ? 'active' : ''} key={value} onClick={() => void persistSettings(locale, value, colorTheme)}>{t(value)}</button>)}</div></section>
          <section className="settings-card palette-section"><h2>{t('colorTheme')}</h2><div className="palette-list">{PALETTES.map((palette) => <button className={`palette-card ${colorTheme === palette.id ? 'selected' : ''}`} key={palette.id} onClick={() => void persistSettings(locale, theme, palette.id)}>
            <span className="palette-preview" style={{ background: palette.background }}><i style={{ background: palette.surface }} /><i style={{ background: palette.primary }} /><i style={{ background: palette.secondary }} /></span>
            <span>{t(palette.id)}</span>{colorTheme === palette.id && <MaterialIcon name="check" size={18} />}
          </button>)}</div></section>
          <section className="settings-card"><h2>{t('sync')}</h2>
            {!isSyncConfigured() ? <p className="warning">{t('clientIdMissing')}</p> : !auth.ready ? <p>{t('checkingAccount')}</p> : auth.account ? <>
              <p className="connected">{t('signedIn')}<strong>{identity?.primary}</strong>{identity?.secondary && <small>{identity.secondary}</small>}<small>{syncStatusLabel(syncStatus, t)}</small><small>{lastSuccessfulSyncAt ? `${t('lastSynced')}: ${formatSyncDateTime(lastSuccessfulSyncAt, locale)}` : t('neverSynced')}</small></p>
              <div className="settings-actions"><button className="primary" disabled={sync.state === 'syncing' || sync.state === 'offline'} onClick={() => void sync.run()}>{sync.state === 'syncing' ? t('syncing') : sync.state === 'error' ? t('retry') : t('syncNow')}</button><button className="secondary" onClick={() => void disconnectMicrosoft()}>{t('signOut')}</button></div>
            </> : <><p>{t('deviceOnly')}</p><button className="primary wide" onClick={() => void connectMicrosoft()}>{t('signIn')}</button></>}
            {(auth.error || sync.error) && <p className="error-message">{auth.error || sync.error}</p>}
          </section>
          <section className="settings-card"><h2>{t('data')}</h2><div className="data-actions">
            <label className="data-action"><span><MaterialIcon name="upload" size={22} /></span><div><strong>{t('import')}</strong><small>{t('importHint')}</small></div><input hidden type="file" accept=".csv,text/csv" onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const imported = importCsv(await file.text())
              await importRecords(imported.events, imported.occurrences)
              setNotice(t('imported')); mutate(); event.target.value = ''
            }} /></label>
            <button className="data-action" onClick={() => {
              const blob = new Blob([exportCsv(events, occurrences)], { type: 'text/csv;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a'); anchor.href = url; anchor.download = `last-time-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click()
              URL.revokeObjectURL(url)
            }}><span><MaterialIcon name="download" size={22} /></span><div><strong>{t('export')}</strong><small>{t('exportHint')}</small></div></button>
          </div>{notice && <p className="success-message">{notice}</p>}</section>
        </div>}
      </main>
      <nav>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}><EventIcon name="clock" /><span>{t('events')}</span></button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><MaterialIcon name="settings" /><span>{t('settings')}</span></button>
      </nav>
      {editingEvent && <EventForm initial={editingEvent === 'new' ? undefined : editingEvent} locale={locale} t={t} onDirtyChange={setEditorDirty} onClose={closeOverlay} onSave={async (draft) => {
        if (editingEvent === 'new') await createEvent(draft)
        else await updateEvent(editingEvent.id, draft)
        mutate(); closeOverlay()
      }} />}
      {detailEvent && <EventDetail event={detailEvent} occurrences={occurrences} locale={locale} t={t} onClose={closeOverlay} onMutate={mutate} onMarkNow={markNow} onEditEvent={() => { setDetailId(null); setEditingEvent(detailEvent) }} />}
      {(update.available || update.error) && !updateDismissed && <div className="update-banner">
        <span>{updateMessage}</span>
        <div><button className="secondary" disabled={update.applying} onClick={() => setUpdateDismissed(true)}>{t('later')}</button>{update.available && <button className="primary" disabled={update.applying} onClick={() => void activatePwaUpdate()}>{update.applying ? t('updating') : t('updateNow')}</button>}</div>
      </div>}
      {syncNotice && <div className={`toast sync-toast ${undo ? 'stacked' : ''}`}>{syncNotice}</div>}
      {undo && <div className="toast">{t('marked')}<button onClick={async () => { window.clearTimeout(undo.timer); await deleteOccurrence(undo.id); setUndo(null); mutate() }}>{t('undo')}</button></div>}
    </div>
  )
}

function syncStatusLabel(status: SyncPresentation, t: ReturnType<typeof translator>) {
  if (status === 'checking') return t('checkingAccount')
  if (status === 'deviceOnly') return t('deviceOnly')
  if (status === 'notSynced') return t('notSyncedYet')
  if (status === 'offline') return t('offlineWaiting')
  if (status === 'syncing') return t('syncing')
  if (status === 'error') return t('syncError')
  return t('synced')
}

function SyncBadge({ status, error, t }: { status: SyncPresentation; error: string; t: ReturnType<typeof translator> }) {
  const icon: MaterialIconName = status === 'deviceOnly' ? 'hardDrive' : status === 'offline' ? 'wifiOff' : 'wifi'
  return <span className={`sync-badge ${status}`} title={error}><MaterialIcon name={icon} size={14} />{syncStatusLabel(status, t)}</span>
}
