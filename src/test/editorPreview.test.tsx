import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventForm } from '../App'
import { translator } from '../i18n'

const props = {
  locale: 'en' as const,
  surfaceColor: '#FFFFFF',
  t: translator('en'),
  onSave: vi.fn(),
  onClose: vi.fn(),
  onDirtyChange: vi.fn()
}

afterEach(() => cleanup())

describe('event editor live preview', () => {
  it('reacts immediately to name, icon, and color changes', () => {
    render(<EventForm {...props} />)
    const preview = screen.getByLabelText('Live preview')
    expect(within(preview).getByText('Item name')).not.toBeNull()
    expect(preview.querySelector('[data-material-symbol="event"]')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic preview' } })
    fireEvent.click(screen.getByLabelText('Grooming'))
    fireEvent.click(screen.getByLabelText('#F2A65A'))

    expect(within(preview).getByText('Synthetic preview')).not.toBeNull()
    expect(preview.querySelector('[data-material-symbol="grooming"]')).not.toBeNull()
    expect(preview.getAttribute('style')).toContain('--event-color: #F2A65A')
  })

  it('renders the selected icon in every color option with a non-color selection cue', () => {
    render(<EventForm {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pets' }))
    const colors = ['#E86F51', '#238C82', '#F2A65A', '#4D73BE', '#9A5A78']
    for (const color of colors) {
      const button = screen.getByLabelText(color)
      expect(button.querySelector('[data-material-symbol="pets"]')).not.toBeNull()
    }
    const selected = screen.getByLabelText('#E86F51')
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.querySelector('.color-selected [data-material-symbol="check"]')).not.toBeNull()
  })

  it('keeps a legacy custom color visible and selected while editing', () => {
    render(<EventForm {...props} initial={{
      id: 'event-1',
      name: 'Legacy fixture',
      note: '',
      icon: 'scissors',
      color: '#123456',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }} />)
    const legacy = screen.getByLabelText('#123456')
    expect(legacy.getAttribute('aria-pressed')).toBe('true')
    expect(legacy.querySelector('[data-material-symbol="grooming"]')).not.toBeNull()
  })
})
