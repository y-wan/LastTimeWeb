import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addOccurrence, createEvent, db, deleteEvent, deleteOccurrence, importRecords, tombstoneAllData, updateEvent, updateOccurrence } from './db'
import { exportCsv, importCsv } from './csv'
import { averageInterval, formatDuration, formatElapsed, formatInterval, formatSyncDateTime, formatSyncTime, historyGroup, toLocalInputValue } from './date'
import { applyLocalizedAppMetadata, initialAppLocale } from './appMetadata'
import { accountIdentity } from './auth'
import { accessibleForeground } from './colorContrast'
import { canClearAllData, clearAllDataWorkflow, CloudDeletionPendingError } from './clearData'
import { EVENT_COLORS } from './eventOptions'
import { iconCatalogue, iconLabel } from './iconCatalogue'
import { EventIcon, MaterialIcon, type MaterialIconName } from './icons'
import { formatUndoBatchMessage, translator } from './i18n'
import { isSyncConfigured, retryAuthRestore, signIn, signOut, subscribeAuth, type AuthSnapshot } from './onedrive'
import { Notice } from './notifications'
import { activatePwaUpdate } from './pwaUpdate'
import { currentAccountLastSync, syncMetaKey, syncPresentation, syncStatusLabel, type SyncPresentation } from './syncStatus'
import { paletteCssVariables, resolvedPaletteRoles, THEME_PALETTES } from './themePalettes'
import type { ColorTheme, EventRecord, Locale, OccurrenceRecord, ThemeMode } from './types'
import { updateStore, type UpdateSnapshot } from './updateStore'
import { useSync } from './useSync'
import { useUndoBatch } from './useUndoBatch'

const EMPTY_EVENTS: EventRecord[] = []
const EMPTY_OCCURRENCES: OccurrenceRecord[] = []

type EventDraft = Pick<EventRecord, 'name' | 'note' | 'icon' | 'color'>
const emptyDraft: EventDraft = { name: '', note: '', icon: 'event', color: EVENT_COLORS[0] }

export function PalettePreview({ roles }: { roles: ReturnType<typeof resolvedPaletteRoles> }) {
  return <span className="palette-preview" style={{ background: roles.background }}>
    <i className="preview-surface" style={{ background: roles.surfaceHigh, borderColor: roles.outline }} />
    <i className="preview-primary" style={{ background: roles.primary }} />
    <i className="preview-secondary" style={{ background: roles.secondary }} />
    <i className="preview-tertiary" style={{ background: roles.tertiary }} />
  </span>
}

function CopilotCredit({ text }: { text: string }) {
  const [prefix, suffix] = text.split('GitHub Copilot')
  return <span>{prefix}<a href="https://github.com/features/copilot" target="_blank" rel="noreferrer">GitHub Copilot</a>{suffix}</span>
}

export function ConfirmationDialog({ title, body, safeLabel, destructiveLabel, destructiveDisabled = false, busy = false, children, onCancel, onConfirm }: {
  title: string
  body: string
  safeLabel: string
  destructiveLabel: string
  destructiveDisabled?: boolean
  busy?: boolean
  children?: React.ReactNode
  onCancel: () => void
  onConfirm: () => void
}) {
  return <div className="modal-backdrop">
    <section className="sheet confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
      <h2 id="confirmation-title">{title}</h2>
      <p>{body}</p>
      {children}
      <div className="dialog-actions">
        <button className="secondary" disabled={busy} onClick={onCancel}>{safeLabel}</button>
        <button className="danger-button" disabled={busy || destructiveDisabled} onClick={onConfirm}>{destructiveLabel}</button>
      </div>
    </section>
  </div>
}

export function ClearDataDialog({ stage, clearing, t, onStage, onCancel, onConfirm }: {
  stage: 'scope' | 'confirm'
  clearing: boolean
  t: ReturnType<typeof translator>
  onStage: (stage: 'scope' | 'confirm') => void
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [confirmation, setConfirmation] = useState('')
  const confirmationWord = t('clearConfirmationWord')
  return stage === 'scope'
    ? <ConfirmationDialog
      title={t('clearAllData')}
      body={t('clearDataScope')}
      safeLabel={t('keepData')}
      destructiveLabel={t('continueClear')}
      busy={clearing}
      onCancel={onCancel}
      onConfirm={() => onStage('confirm')}
    />
    : <ConfirmationDialog
      title={t('confirmClearTitle')}
      body={t('clearConfirmationInstruction')}
      safeLabel={t('keepData')}
      destructiveLabel={clearing ? t('clearingData') : t('clearAllData')}
      destructiveDisabled={confirmation !== confirmationWord}
      busy={clearing}
      onCancel={onCancel}
      onConfirm={() => void onConfirm()}
    >
      <strong className="confirmation-word">{confirmationWord}</strong>
        <input autoFocus aria-label={t('clearConfirmationLabel')} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
    </ConfirmationDialog>
}

export function EventForm({ initial, locale, surfaceColor, t, onSave, onClose, onDirtyChange }: {
  initial?: EventRecord
  locale: Locale
  surfaceColor: string
  t: ReturnType<typeof translator>
  onSave: (draft: EventDraft) => Promise<void>
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const original: EventDraft = initial
    ? { name: initial.name, note: initial.note, icon: initial.icon, color: initial.color }
    : emptyDraft
  const [draft, setDraft] = useState<EventDraft>(original)
  const selectableColors = EVENT_COLORS.includes(draft.color as typeof EVENT_COLORS[number])
    ? EVENT_COLORS
    : [draft.color, ...EVENT_COLORS]
  const previewStyle = {
    '--event-color': draft.color,
    '--event-foreground': accessibleForeground(draft.color, surfaceColor)
  } as CSSProperties
  const dirty = JSON.stringify(draft) !== JSON.stringify(original)
  const requestClose = onClose
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
    <div className="screen-overlay">
      <form className="screen-sheet editor-screen" onSubmit={(event) => {
        event.preventDefault()
        void onSave({ ...draft, name: draft.name.trim(), note: draft.note.trim() })
      }}>
        <div className="editor-header">
          <button type="button" className="icon-button" aria-label={t('back')} onClick={requestClose}><MaterialIcon name="back" /></button>
          <h2>{initial ? t('edit') : t('addEvent')}</h2>
          <button className="text-button" disabled={!draft.name.trim()}>{t('saveEvent')}</button>
        </div>
        <section className="event-preview" style={previewStyle} aria-label={t('eventPreview')}>
          <span><EventIcon name={draft.icon} size={30} /></span>
          <div><small>{t('eventPreview')}</small><strong>{draft.name.trim() || t('previewPlaceholder')}</strong></div>
        </section>
        <label>{t('name')}<input autoFocus required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>{t('note')} <span className="muted">{t('optional')}</span><textarea maxLength={500} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <fieldset><legend>{t('chooseIcon')}</legend><div className="icon-grid">
          {iconCatalogue.map((icon) => <button aria-label={iconLabel(icon, locale)} className={draft.icon === icon ? 'selected' : ''} type="button" key={icon} onClick={() => setDraft({ ...draft, icon })}><EventIcon name={icon} size={30} /><span>{iconLabel(icon, locale)}</span></button>)}
        </div></fieldset>
        <fieldset><legend>{t('chooseColor')}</legend><div className="color-grid">
          {selectableColors.map((color) => {
            const style = {
              '--swatch-color': color,
              '--swatch-foreground': accessibleForeground(color, surfaceColor)
            } as CSSProperties
            return <button aria-label={color} aria-pressed={draft.color === color} className={draft.color === color ? 'selected' : ''} style={style} type="button" key={color} onClick={() => setDraft({ ...draft, color })}>
              <span className="color-icon"><EventIcon name={draft.icon} size={22} /></span>
              {draft.color === color && <span className="color-selected"><MaterialIcon name="check" size={12} /></span>}
            </button>
          })}
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

export function EventDetail({ event, occurrences, locale, surfaceColor, t, onClose, onMutate, onOccurrenceAdded, onEditEvent, onMarkNow, onRequestDeleteEvent, onRequestDeleteOccurrence }: {
  event: EventRecord
  occurrences: OccurrenceRecord[]
  locale: Locale
  surfaceColor: string
  t: ReturnType<typeof translator>
  onClose: () => void
  onMutate: () => void
  onOccurrenceAdded: (occurrenceId: string) => void
  onEditEvent: () => void
  onMarkNow?: (eventId: string) => Promise<void>
  onRequestDeleteEvent: () => void
  onRequestDeleteOccurrence: (occurrenceId: string) => void
}) {
  const [editing, setEditing] = useState<OccurrenceRecord | null | 'new'>(null)
  const history = occurrences.filter((item) => item.eventId === event.id && !item.deletedAt).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  const average = averageInterval(history.map((item) => item.occurredAt))
  const predicted = average && history[0] ? new Date(new Date(history[0].occurredAt).getTime() + average) : undefined
  return (
    <div className="screen-overlay">
      <section className="screen-sheet detail-screen">
        <div className="detail-header">
          <button className="icon-button" aria-label={t('back')} onClick={onClose}><MaterialIcon name="back" /></button>
          <h2>{event.name}</h2>
          <div>
            <button className="icon-button" aria-label={t('edit')} onClick={onEditEvent}><MaterialIcon name="edit" size={20} /></button>
            <button className="icon-button danger-icon" aria-label={t('delete')} onClick={onRequestDeleteEvent}><MaterialIcon name="delete" size={20} /></button>
          </div>
        </div>
        <div className="detail-event-icon" style={{
          '--event-color': event.color,
          '--event-foreground': accessibleForeground(event.color, surfaceColor)
        } as CSSProperties}><EventIcon name={event.icon} size={34} /></div>
        <div className="detail-actions">
          <button className="primary" onClick={() => void onMarkNow?.(event.id)}><MaterialIcon name="check" size={20} />{t('markNow')}</button>
          <button className="secondary" onClick={() => setEditing('new')}><MaterialIcon name="event" size={20} />{t('addOccurrence')}</button>
        </div>
        <section className="stats-card">
          <h3>{t('statistics')}</h3>
          <div className="stats-grid">
            <div><small>{t('averageInterval')}</small><strong>{average ? formatDuration(average, locale) : t('insufficientData')}</strong></div>
            <div><small>{t('predictedNext')}</small><strong>{predicted ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(predicted) : t('insufficientData')}</strong></div>
          </div>
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
            <button className="icon-button danger-icon" aria-label={t('deleteRecord')} onClick={() => onRequestDeleteOccurrence(item.id)}><MaterialIcon name="delete" size={18} /></button>
          </article>)}
        </div>
      </section>
      {editing && <OccurrenceEditor occurrence={editing === 'new' ? undefined : editing} t={t} onClose={() => setEditing(null)} onSave={async (occurredAt, note) => {
        if (editing === 'new') {
          const occurrence = await addOccurrence(event.id, occurredAt, note)
          setEditing(null)
          onOccurrenceAdded(occurrence.id)
        } else {
          await updateOccurrence(editing.id, occurredAt, note)
          setEditing(null)
          onMutate()
        }
      }} />}
    </div>
  )
}

export default function App() {
  const events = useLiveQuery(() => db.events.filter((event) => !event.deletedAt).toArray(), []) ?? EMPTY_EVENTS
  const occurrences = useLiveQuery(() => db.occurrences.filter((item) => !item.deletedAt).toArray(), []) ?? EMPTY_OCCURRENCES
  const settings = useLiveQuery(() => db.settings.get('settings'), [])
  const [locale, setLocale] = useState<Locale>(() => initialAppLocale(navigator.language))
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [colorTheme, setColorTheme] = useState<ColorTheme>('vitalOrange')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [tab, setTab] = useState<'events' | 'settings'>('events')
  const [editingEvent, setEditingEvent] = useState<EventRecord | null | 'new'>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [auth, setAuth] = useState<AuthSnapshot>(
    isSyncConfigured()
      ? { ready: false, status: 'checking' }
      : { ready: true, status: 'disconnected' }
  )
  const [notice, setNotice] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [update, setUpdate] = useState<UpdateSnapshot>({ available: false, applying: false })
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [settingsErrorDismissed, setSettingsErrorDismissed] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [clearStage, setClearStage] = useState<'scope' | 'confirm' | null>(null)
  const [clearingData, setClearingData] = useState(false)
  const [clearNotice, setClearNotice] = useState<{ summary: string; detail: string } | null>(null)
  const [confirmation, setConfirmation] = useState<
    { kind: 'discard' } |
    { kind: 'deleteEvent'; eventId: string } |
    { kind: 'deleteOccurrence'; occurrenceId: string } |
    null
  >(null)
  const [confirming, setConfirming] = useState(false)
  const overlayHistoryActive = useRef(false)
  const allowOverlayClose = useRef(false)
  const t = useMemo(() => translator(locale), [locale])
  const accountId = auth.account?.homeAccountId
  const syncMeta = useLiveQuery(() => accountId ? db.syncMeta.get(syncMetaKey(accountId)) : undefined, [accountId])
  const lastSuccessfulSyncAt = currentAccountLastSync(accountId, syncMeta)
  const sync = useSync(accountId)
  const scheduleSync = sync.schedule
  const mutate = useCallback(() => scheduleSync(), [scheduleSync])
  const undo = useUndoBatch(deleteOccurrence, mutate)
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
    applyLocalizedAppMetadata(locale)
    const roles = resolvedPaletteRoles(colorTheme, theme, systemDark)
    for (const [property, value] of Object.entries(paletteCssVariables(roles))) {
      document.documentElement.style.setProperty(property, value)
    }
    document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', roles.background)
  }, [colorTheme, theme, locale, systemDark])
  useEffect(() => subscribeAuth(setAuth), [])
  useEffect(() => {
    const retryWhenOnline = () => {
      void retryAuthRestore()
    }
    window.addEventListener('online', retryWhenOnline)
    return () => window.removeEventListener('online', retryWhenOnline)
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => updateStore.subscribe((snapshot) => {
    setUpdate(snapshot)
    if (snapshot.available && !snapshot.error) setUpdateDismissed(false)
  }), [])
  useEffect(() => {
    if (update.error) setUpdateDismissed(false)
  }, [update.error])
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
      if (!allowOverlayClose.current && editorDirty) {
        window.history.pushState({ lastTimeOverlay: true }, '')
        setConfirmation({ kind: 'discard' })
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
    if (!sync.userCompletion || sync.userCompletion.accountId !== accountId) {
      setSyncNotice('')
      return
    }
    setSyncNotice(`${t('syncSucceeded')} · ${formatSyncTime(sync.userCompletion.completedAt, locale)}`)
    const timer = window.setTimeout(() => setSyncNotice(''), 4_000)
    return () => window.clearTimeout(timer)
  }, [accountId, locale, sync.userCompletion, t])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4_000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const settingsError = auth.error || sync.error
  useEffect(() => {
    setSettingsErrorDismissed(false)
  }, [settingsError])
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
  const surfaceColor = resolvedPaletteRoles(colorTheme, theme, systemDark).surface
  const previewDark = theme === 'dark' || (theme === 'system' && systemDark)
  const identity = auth.account ? accountIdentity(auth.account) : undefined
  const undoFailure = undo.failures[0]
  const updateMessage = update.errorKind === 'timeout'
    ? t('updateTimeout')
    : update.errorKind === 'network'
      ? t('updateNetworkFailed')
      : update.error
        ? t('updateFailed')
        : t('updateAvailable')

  const markNow = async (eventId: string) => {
    const occurrence = await addOccurrence(eventId)
    undo.add(occurrence.id)
  }

  const closeOverlay = () => {
    allowOverlayClose.current = true
    if (overlayHistoryActive.current) window.history.back()
    else {
      setEditingEvent(null)
      setDetailId(null)
    }
  }
  const requestEditorClose = () => {
    if (editorDirty) setConfirmation({ kind: 'discard' })
    else closeOverlay()
  }

  const persistSettings = async (nextLocale: Locale, nextTheme: ThemeMode, nextColorTheme: ColorTheme) => {
    setLocale(nextLocale); setTheme(nextTheme); setColorTheme(nextColorTheme)
    await db.settings.put({ key: 'settings', locale: nextLocale, theme: nextTheme, colorTheme: nextColorTheme })
  }

  const connectMicrosoft = async () => {
    setAuth((current) => ({ ...current, error: undefined }))
    try {
      const account = await signIn()
      await sync.runUser(account.homeAccountId)
    } catch (cause) {
      setAuth((current) => ({
        ...current,
        ready: true,
        status: current.status === 'reconnect-required' ? 'reconnect-required' : 'error',
        error: cause instanceof Error ? cause.message : String(cause)
      }))
    }
  }

  const disconnectMicrosoft = async () => {
    setAuth((current) => ({ ...current, error: undefined }))
    try {
      await signOut()
    } catch (cause) {
      setAuth((current) => ({
        ...current,
        ready: true,
        status: 'disconnected',
        account: undefined,
        error: cause instanceof Error ? cause.message : String(cause)
      }))
    }
  }

  const grouped = (['today', 'recent', 'earlier', 'never'] as const).map((group) => ({
    group,
    events: sorted.filter((event) => historyGroup(latestByEvent.get(event.id)?.occurredAt) === group)
  }))
  const hasActiveData = events.length > 0 || occurrences.length > 0
  const clearEnabled = canClearAllData({
    authReady: auth.ready,
    signedIn: Boolean(auth.account),
    online: navigator.onLine,
    hasData: hasActiveData,
    clearing: clearingData
  })
  const clearDisabledReason = !auth.ready
    ? t('checkingAccount')
    : !auth.account
      ? t('clearRequiresSignIn')
      : !navigator.onLine
        ? t('clearRequiresOnline')
        : !hasActiveData
          ? t('clearNoData')
          : ''

  const confirmClearAllData = async () => {
    if (!clearEnabled) return
    setClearingData(true)
    setClearNotice(null)
    try {
      await clearAllDataWorkflow(sync.runRequired, tombstoneAllData)
      setClearStage(null)
      setNotice(t('clearSucceeded'))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setClearNotice({
        summary: error instanceof CloudDeletionPendingError ? t('clearCloudPending') : t('clearPreSyncFailed'),
        detail
      })
      setClearStage(null)
    } finally {
      setClearingData(false)
    }
  }

  return (
    <div className="app-shell">
      {!overlayOpen && <header>
        <div><h1>{t('appName')}</h1><p>{t('subtitle')}</p></div>
        <div className="sync-control" data-status={syncStatus}>
          <SyncBadge status={syncStatus} t={t} />
          {syncStatus === 'deviceOnly' && isSyncConfigured() && <button className="sync-cta" disabled={auth.offline} onClick={() => void connectMicrosoft()}>
            {auth.status === 'reconnect-required' ? t('reconnectMicrosoft') : t('signIn')}
          </button>}
        </div>
      </header>}
      {!overlayOpen && <main>
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
                  const eventStyle = {
                    '--event-color': event.color,
                    '--event-foreground': accessibleForeground(event.color, surfaceColor)
                  } as CSSProperties
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
          <section className="settings-card"><h2>{t('language')}</h2><div className="segmented"><button className={locale === 'en' ? 'active' : ''} onClick={() => void persistSettings('en', theme, colorTheme)}>{t('englishLanguage')}</button><button className={locale === 'zh-CN' ? 'active' : ''} onClick={() => void persistSettings('zh-CN', theme, colorTheme)}>{t('simplifiedChineseLanguage')}</button></div></section>
          <section className="settings-card"><h2>{t('appearance')}</h2><div className="segmented">{(['system', 'light', 'dark'] as ThemeMode[]).map((value) => <button className={theme === value ? 'active' : ''} key={value} onClick={() => void persistSettings(locale, value, colorTheme)}>{t(value)}</button>)}</div></section>
          <section className="settings-card palette-section"><h2>{t('colorTheme')}</h2><div className="palette-list">{THEME_PALETTES.map((palette) => {
            const roles = previewDark ? palette.dark : palette.light
            return <button className={`palette-card ${colorTheme === palette.id ? 'selected' : ''}`} data-palette-preview={palette.id} key={palette.id} onClick={() => void persistSettings(locale, theme, palette.id)}>
            <PalettePreview roles={roles} />
            <span className="palette-title">{t(palette.id)}<i className="palette-baseline-probe" aria-hidden="true" /></span>
            {colorTheme === palette.id && <span className="palette-check"><MaterialIcon name="check" size={18} /></span>}
          </button>
          })}</div></section>
          <section className="settings-card"><h2>{t('sync')}</h2>
            {!isSyncConfigured() ? <p className="warning">{t('clientIdMissing')}</p> : !auth.ready ? <p>{auth.status === 'restoring' ? t('restoringMicrosoft') : t('checkingAccount')}</p> : auth.account ? <>
              <ConnectedAccountSummary
                identity={identity}
                lastSuccessfulSyncAt={lastSuccessfulSyncAt}
                locale={locale}
                t={t}
              />
              <div className="settings-actions"><button className="primary" disabled={sync.state === 'syncing' || sync.state === 'offline'} onClick={() => void sync.runUser()}>{sync.state === 'syncing' ? t('syncing') : sync.state === 'error' ? t('retry') : t('syncNow')}</button><button className="secondary" onClick={() => void disconnectMicrosoft()}>{t('signOut')}</button></div>
            </> : auth.status === 'reconnect-required' ? <>
              <p>{auth.offline ? t('reconnectMicrosoftOffline') : t('reconnectMicrosoftBody')}</p>
              <button className="primary wide" disabled={auth.offline} onClick={() => void connectMicrosoft()}>{t('reconnectMicrosoft')}</button>
            </> : <><p>{t('deviceOnly')}</p><button className="primary wide" onClick={() => void connectMicrosoft()}>{t('signIn')}</button></>}
            {settingsError && !settingsErrorDismissed && <Notice
              className="inline-notice error-message"
              message={auth.error ? t('accountFailed') : t('syncFailed')}
              detail={settingsError}
              showDetailsLabel={t('showDetails')}
              hideDetailsLabel={t('hideDetails')}
              copyDetailsLabel={t('copyDetails')}
              copiedLabel={t('copied')}
              copyFailedLabel={t('copyFailed')}
              dismissLabel={t('dismiss')}
              onDismiss={() => setSettingsErrorDismissed(true)}
            />}
          </section>
          <section className="settings-card"><h2>{t('data')}</h2><div className="data-actions">
            <label className="data-action"><span><MaterialIcon name="upload" size={22} /></span><div><strong>{t('import')}</strong><small>{t('importHint')}</small></div><input hidden type="file" accept=".csv,text/csv" onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const imported = await importCsv(await file.text())
              await importRecords(imported.events, imported.occurrences)
              setNotice(t('imported')); mutate(); event.target.value = ''
            }} /></label>
            <button className="data-action" onClick={() => {
              const blob = new Blob([exportCsv(events, occurrences)], { type: 'text/csv;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a'); anchor.href = url; anchor.download = `last-time-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click()
              URL.revokeObjectURL(url)
            }}><span><MaterialIcon name="download" size={22} /></span><div><strong>{t('export')}</strong><small>{t('exportHint')}</small></div></button>
          </div>{notice && <p className="success-message">{notice}</p>}
          </section>
          <section className="settings-card about-card">
            <h2>{t('aboutCredits')}</h2>
            <p>{locale === 'en' ? <>
              {t('aboutInspiredPrefix')}<a href="https://apps.apple.com/app/id534982023" target="_blank" rel="noreferrer">{t('originalAppName')}</a>{t('aboutForIosBy')}<a href="https://sarunw.com/" target="_blank" rel="noreferrer">Sarun Wongpatcharapakorn</a>{t('aboutInspiredSuffix')}{t('aboutCreditThanks')} {t('aboutIndependent')}
            </> : <>
              {t('aboutInspiredPrefix')}<a href="https://sarunw.com/" target="_blank" rel="noreferrer">Sarun Wongpatcharapakorn</a>{t('aboutDevelopedApp')}<a href="https://apps.apple.com/app/id534982023" target="_blank" rel="noreferrer">{t('originalAppName')}</a>{t('aboutInspiredSuffix')}{t('aboutCreditThanks')}{t('aboutIndependent')}
            </>}</p>
            <p>{t('aboutRecommendation')} <a href="https://apps.apple.com/app/id534982023" target="_blank" rel="noreferrer">{t('originalAppLink')}</a>{t('sentenceEnd')}</p>
            <div className="about-links">
              <a className="external-link" href="https://lasttimeapp.com/" target="_blank" rel="noreferrer">
                <MaterialIcon name="external" size={20} /><span>{t('officialWebsite')}</span>
              </a>
              <a className="external-link" href="https://apps.apple.com/app/id534982023" target="_blank" rel="noreferrer">
                <MaterialIcon name="external" size={20} /><span>{t('viewOnAppStore')}</span>
              </a>
            </div>
            <div className="credit-footer">
              <MaterialIcon name="favorite" size={14} />
              <CopilotCredit text={t('builtWithCopilot')} />
            </div>
          </section>
          <section className="settings-card danger-zone">
            <h2>{t('dangerZone')}</h2>
            <p>{t('clearDataSummary')}</p>
            <button className="danger-button wide" disabled={!clearEnabled} onClick={() => { setClearNotice(null); setClearStage('scope') }}>{t('clearAllData')}</button>
            {clearDisabledReason && <small>{clearDisabledReason}</small>}
            {clearNotice && <Notice
              className="inline-notice error-message"
              message={clearNotice.summary}
              detail={clearNotice.detail}
              showDetailsLabel={t('showDetails')}
              hideDetailsLabel={t('hideDetails')}
              copyDetailsLabel={t('copyDetails')}
              copiedLabel={t('copied')}
              copyFailedLabel={t('copyFailed')}
              dismissLabel={t('dismiss')}
              onDismiss={() => setClearNotice(null)}
            />}
          </section>
        </div>}
      </main>}
      {!overlayOpen && <nav>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}><EventIcon name="clock" /><span>{t('events')}</span></button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><MaterialIcon name="settings" /><span>{t('settings')}</span></button>
      </nav>}
      {editingEvent && <EventForm initial={editingEvent === 'new' ? undefined : editingEvent} locale={locale} surfaceColor={surfaceColor} t={t} onDirtyChange={setEditorDirty} onClose={requestEditorClose} onSave={async (draft) => {
        if (editingEvent === 'new') await createEvent(draft)
        else await updateEvent(editingEvent.id, draft)
        mutate(); closeOverlay()
      }} />}
      {detailEvent && <EventDetail event={detailEvent} occurrences={occurrences} locale={locale} surfaceColor={surfaceColor} t={t} onClose={closeOverlay} onMutate={mutate} onOccurrenceAdded={undo.add} onMarkNow={markNow} onEditEvent={() => { setDetailId(null); setEditingEvent(detailEvent) }} onRequestDeleteEvent={() => setConfirmation({ kind: 'deleteEvent', eventId: detailEvent.id })} onRequestDeleteOccurrence={(occurrenceId) => setConfirmation({ kind: 'deleteOccurrence', occurrenceId })} />}
      {clearStage && <ClearDataDialog stage={clearStage} clearing={clearingData} t={t} onStage={setClearStage} onCancel={() => { if (!clearingData) setClearStage(null) }} onConfirm={confirmClearAllData} />}
      {confirmation && <ConfirmationDialog
        title={t(confirmation.kind === 'discard' ? 'discardTitle' : confirmation.kind === 'deleteEvent' ? 'deleteEventTitle' : 'deleteRecordTitle')}
        body={t(confirmation.kind === 'discard' ? 'discardBody' : confirmation.kind === 'deleteEvent' ? 'deleteEventBody' : 'deleteRecordBody')}
        safeLabel={t(confirmation.kind === 'discard' ? 'keepEditing' : confirmation.kind === 'deleteEvent' ? 'keepItem' : 'keepRecord')}
        destructiveLabel={t(confirmation.kind === 'discard' ? 'discardAction' : confirmation.kind === 'deleteEvent' ? 'deleteItemAction' : 'deleteRecordAction')}
        busy={confirming}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void (async () => {
          setConfirming(true)
          try {
            if (confirmation.kind === 'discard') closeOverlay()
            else if (confirmation.kind === 'deleteEvent') { await deleteEvent(confirmation.eventId); mutate(); closeOverlay() }
            else { await deleteOccurrence(confirmation.occurrenceId); mutate() }
            setConfirmation(null)
          } finally {
            setConfirming(false)
          }
        })()}
      />}
      {(update.available || update.error) && !updateDismissed && <Notice
        className="update-banner"
        message={updateMessage}
        detail={update.error}
        showDetailsLabel={t('showDetails')}
        hideDetailsLabel={t('hideDetails')}
        copyDetailsLabel={t('copyDetails')}
        copiedLabel={t('copied')}
        copyFailedLabel={t('copyFailed')}
        dismissLabel={update.error ? t('dismiss') : t('later')}
        onDismiss={() => setUpdateDismissed(true)}
      >
        {update.available && <button className="primary" disabled={update.applying} onClick={() => void activatePwaUpdate()}>{update.applying ? t('updating') : t('updateNow')}</button>}
      </Notice>}
      {undoFailure && <Notice
        className="toast error-toast"
        message={t('undoFailed')}
        detail={undoFailure.detail}
        showDetailsLabel={t('showDetails')}
        hideDetailsLabel={t('hideDetails')}
        copyDetailsLabel={t('copyDetails')}
        copiedLabel={t('copied')}
        copyFailedLabel={t('copyFailed')}
        dismissLabel={t('dismiss')}
        onDismiss={() => undo.dismissFailure(undoFailure.occurrenceId)}
      >
        <button className="primary" disabled={undo.retryingOccurrenceId === undoFailure.occurrenceId} onClick={() => void undo.retryFailure(undoFailure.occurrenceId)}>
          {undo.retryingOccurrenceId === undoFailure.occurrenceId ? t('retrying') : t('retry')}
        </button>
      </Notice>}
      {syncNotice && <div className={`toast sync-toast ${undo.batch ? 'stacked' : ''}`}>{syncNotice}</div>}
      {undo.batch && <div className="toast undo-toast" role="status">
        <span className="notice-message">
          {undo.batch.occurrenceIds.length === 1
            ? t('marked')
            : formatUndoBatchMessage(locale, undo.batch.occurrenceIds.length)}
        </span>
        <button onClick={undo.undo}>{undo.batch.occurrenceIds.length === 1 ? t('undo') : t('undoAll')}</button>
      </div>}
    </div>
  )
}

export function SyncBadge({ status, t }: { status: SyncPresentation; t: ReturnType<typeof translator> }) {
  const icon: MaterialIconName = status === 'deviceOnly' ? 'hardDrive' : status === 'offline' ? 'wifiOff' : 'wifi'
  const label = syncStatusLabel(status, t)
  return <span className={`sync-badge ${status}`} aria-label={label} title={status === 'error' ? label : undefined}>
    <MaterialIcon name={icon} size={14} />
    <span className="sync-badge-label">{label}</span>
  </span>
}

export function ConnectedAccountSummary({
  identity,
  lastSuccessfulSyncAt,
  locale,
  t
}: {
  identity?: { primary: string; secondary: string }
  lastSuccessfulSyncAt?: string
  locale: Locale
  t: ReturnType<typeof translator>
}) {
  return <p className="connected">
    {t('signedIn')}
    <strong>{identity?.primary}</strong>
    {identity?.secondary && <small>{identity.secondary}</small>}
    {lastSuccessfulSyncAt && <small>{t('lastSynced')}: {formatSyncDateTime(lastSuccessfulSyncAt, locale)}</small>}
  </p>
}
