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
    fireEvent.click(await screen.findByLabelText('Add event'))

    await waitFor(() => expect(window.history.state).toEqual({ lastTimeOverlay: true }))
    expect(document.querySelector('.editor-screen')).not.toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()

    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => expect(document.querySelector('.editor-screen')).toBeNull())
    expect(screen.getByRole('navigation')).not.toBeNull()
  })
})
