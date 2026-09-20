import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db'
import { withDataOperationLock } from '../operationLock'
import { startUndoWindow } from '../undoWindow'

beforeEach(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  })
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  await db.events.clear()
  await db.occurrences.clear()
  await db.settings.clear()
  await db.microsoftAuthState.clear()
  await db.events.add({
    id: 'event-1',
    name: 'Fixture event',
    note: '',
    icon: 'event',
    color: '#E86F51',
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z'
  })
  await db.occurrences.add({
    id: 'occurrence-1',
    eventId: 'event-1',
    occurredAt: '2026-09-18T00:00:00.000Z',
    note: '',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z'
  })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('full-screen navigation', () => {
  it('opens detail as an opaque routed screen and browser back returns home', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Fixture event'))

    await waitFor(() => expect(window.history.state).toEqual({ lastTimeOverlay: true }))
    expect(document.querySelector('.screen-overlay')).not.toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()

    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => expect(document.querySelector('.screen-overlay')).toBeNull())
    expect(screen.getByRole('navigation')).not.toBeNull()
  })

  describe('mark undo window', () => {
    it('consolidates multiple records into one English undo action', async () => {
      render(<App />)
      const record = await screen.findByLabelText('Record Fixture event')

      fireEvent.click(record)
      expect(await screen.findByText('Recorded as done')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull()
      await waitFor(async () => expect(await db.occurrences.count()).toBe(2))

      fireEvent.click(screen.getByLabelText('Record Fixture event'))
      await waitFor(async () => expect(await db.occurrences.count()).toBe(3))
      expect(await screen.findByText('2 records added')).not.toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Undo all' }))
      expect(screen.queryByText('2 records added')).toBeNull()

      await waitFor(async () => {
        const added = (await db.occurrences.toArray()).filter((item) => item.id !== 'occurrence-1')
        expect(added).toHaveLength(2)
        expect(added.every((item) => Boolean(item.deletedAt))).toBe(true)
      })
    })

    it('localizes the consolidated undo message and action in Chinese', async () => {
      await db.settings.put({ key: 'settings', locale: 'zh-CN', theme: 'system', colorTheme: 'vitalOrange' })
      render(<App />)
      const record = await screen.findByLabelText('记录 Fixture event')

      fireEvent.click(record)
      await waitFor(async () => expect(await db.occurrences.count()).toBe(2))
      fireEvent.click(screen.getByLabelText('记录 Fixture event'))
      await waitFor(async () => expect(await db.occurrences.count()).toBe(3))

      expect(await screen.findByText('已添加 2 条记录')).not.toBeNull()
      expect(screen.getByRole('button', { name: '全部撤销' })).not.toBeNull()
    })

    it('adds a past record to the same undo flow', async () => {
      render(<App />)
      fireEvent.click(await screen.findByText('Fixture event'))
      fireEvent.click(await screen.findByRole('button', { name: 'Add past record' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('Recorded as done')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull()
    })

    it('dismisses immediately even while the tombstone waits for the data lock', async () => {
      render(<App />)
      fireEvent.click(await screen.findByLabelText('Record Fixture event'))
      expect(await screen.findByText('Recorded as done')).not.toBeNull()

      let releaseLock = () => {}
      const heldLock = withDataOperationLock(() => new Promise<void>((resolve) => {
        releaseLock = resolve
      }))
      await act(async () => Promise.resolve())

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(screen.queryByText('Recorded as done')).toBeNull()

      const pending = (await db.occurrences.toArray()).find((item) => item.id !== 'occurrence-1')
      expect(pending?.deletedAt).toBeUndefined()

      releaseLock()
      await heldLock
      await waitFor(async () => {
        expect((await db.occurrences.get(pending!.id))?.deletedAt).toBeTruthy()
      })
    })

    it('expires only after the full ten-second window', () => {
      vi.useFakeTimers()
      const expire = vi.fn()
      startUndoWindow(expire)

      act(() => vi.advanceTimersByTime(9_999))
      expect(expire).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(expire).toHaveBeenCalledOnce()
    })
  })

  it('opens the event editor full-screen and honors browser back', async () => {
    render(<App />)
    fireEvent.click(await screen.findByLabelText('Add item'))

    await waitFor(() => expect(window.history.state).toEqual({ lastTimeOverlay: true }))
    expect(document.querySelector('.editor-screen')).not.toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved fixture' } })
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByText('Discard changes?')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(document.querySelector('.editor-screen')).not.toBeNull()

    window.dispatchEvent(new PopStateEvent('popstate'))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(document.querySelector('.editor-screen')).toBeNull())
    expect(screen.getByRole('navigation')).not.toBeNull()
  })

  it('uses explicit custom dialogs for event and history-record deletion', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Fixture event'))
    fireEvent.click(screen.getByLabelText('Delete'))
    expect(screen.getByText('Delete item?')).not.toBeNull()
    expect(screen.getByText('All history for this item will also be deleted. This can’t be undone.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep item' }))
    expect(screen.queryByText('Delete item?')).toBeNull()

    fireEvent.click(screen.getByLabelText('Delete record'))
    expect(screen.getByText('Delete this record?')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep record' }))
    expect(screen.queryByText('Delete this record?')).toBeNull()
  })

  it('disables cloud-wide clearing while signed out', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const clear = await screen.findByRole('button', { name: 'Clear all data' })
    expect(clear.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Sign in to Microsoft to clear this device and OneDrive.')).not.toBeNull()
  })

  it('credits the original iOS app with a safe external link before the danger zone', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const original = await screen.findByRole('link', { name: 'Last Time Tracker' })
    const author = screen.getByRole('link', { name: 'Sarun Wongpatcharapakorn' })
    const website = await screen.findByRole('link', { name: 'Official website' })
    const appStore = screen.getByRole('link', { name: 'View on the App Store' })
    const recommendation = screen.getByRole('link', { name: 'original Last Time Tracker' })
    const copilot = screen.getByRole('link', { name: 'GitHub Copilot' })
    expect(original.getAttribute('href')).toBe('https://apps.apple.com/app/id534982023')
    expect(author.getAttribute('href')).toBe('https://sarunw.com/')
    expect(website.getAttribute('href')).toBe('https://lasttimeapp.com/')
    expect(appStore.getAttribute('href')).toBe('https://apps.apple.com/app/id534982023')
    expect(recommendation.getAttribute('href')).toBe('https://apps.apple.com/app/id534982023')
    expect(copilot.getAttribute('href')).toBe('https://github.com/features/copilot')
    for (const link of [original, author, website, appStore, recommendation, copilot]) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noreferrer')
    }
    expect(screen.getByText(/independent, unofficial implementation/)).not.toBeNull()
    expect(screen.getByText(/encourage you to support and use the/)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '简体中文' }))
    expect((await screen.findByRole('link', { name: '官方网站' })).getAttribute('href')).toBe('https://lasttimeapp.com/')
    expect(screen.getByRole('link', { name: '在 App Store 查看' }).getAttribute('href')).toBe('https://apps.apple.com/app/id534982023')
    expect(screen.getByRole('link', { name: '原版「上次」' }).getAttribute('href')).toBe('https://apps.apple.com/app/id534982023')
    expect(document.querySelector('.credit-footer')?.textContent).toBe('与 GitHub Copilot 一起打造')

    const cards = [...document.querySelectorAll('.settings-card')]
    expect(cards.at(-2)?.classList.contains('about-card')).toBe(true)
    expect(cards.at(-1)?.classList.contains('danger-zone')).toBe(true)
  })
})
