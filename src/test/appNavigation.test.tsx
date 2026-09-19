import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../db'

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
  await db.events.clear()
  await db.occurrences.clear()
  await db.settings.clear()
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

afterEach(() => cleanup())

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
})
