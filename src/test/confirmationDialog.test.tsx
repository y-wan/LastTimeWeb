import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClearDataDialog, ConfirmationDialog } from '../App'
import { translator } from '../i18n'
import { Notice } from '../notifications'

afterEach(() => {
  cleanup()
})

describe('localized confirmation dialogs', () => {
  it.each([
    ['en', 'Discard changes?', 'Your unsaved changes will be lost.', 'Keep editing', 'Discard changes'],
    ['zh-CN', '放弃更改？', '尚未保存的内容将会丢失。', '继续编辑', '放弃更改']
  ] as const)('renders explicit discard actions in %s', (locale, title, body, safe, destructive) => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const t = translator(locale)
    render(<ConfirmationDialog title={t('discardTitle')} body={t('discardBody')} safeLabel={t('keepEditing')} destructiveLabel={t('discardAction')} onCancel={onCancel} onConfirm={onConfirm} />)
    expect(screen.getByText(title)).not.toBeNull()
    expect(screen.getByText(body)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: safe }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: destructive }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  describe('technical error disclosure', () => {
    it('keeps details collapsed while dismiss remains available', () => {
      const dismiss = vi.fn()
      render(<Notice
        message="Update failed. Try again."
        detail="TechnicalFailureCodeWithoutBreaks"
        showDetailsLabel="Show details"
        hideDetailsLabel="Hide details"
        copyDetailsLabel="Copy details"
        copiedLabel="Copied"
        dismissLabel="Dismiss"
        onDismiss={dismiss}
      />)

      expect(screen.getByRole('alert')).not.toBeNull()
      expect(screen.queryByText('TechnicalFailureCodeWithoutBreaks')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(dismiss).toHaveBeenCalledOnce()
    })

    it('expands, copies, reports success, and collapses technical details', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      const detail = 'TechnicalFailureCodeWithoutBreaks'
      render(<Notice
        message="Update failed. Try again."
        detail={detail}
        showDetailsLabel="Show details"
        hideDetailsLabel="Hide details"
        copyDetailsLabel="Copy details"
        copiedLabel="Copied"
      />)

      const toggle = screen.getByRole('button', { name: 'Show details' })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(toggle)
      expect(screen.getByText(detail)).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Hide details' }).getAttribute('aria-expanded')).toBe('true')

      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
      expect(writeText).toHaveBeenCalledWith(detail)
      expect(await screen.findByRole('button', { name: 'Copied' })).not.toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
      expect(screen.queryByText(detail)).toBeNull()
    })
  })

  it('requires both clear-data stages and exact confirmation text', () => {
    const onStage = vi.fn()
    const onCancel = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const t = translator('en')
    const { rerender } = render(<ClearDataDialog stage="scope" clearing={false} t={t} onStage={onStage} onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep data' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }))
    expect(onStage).toHaveBeenCalledWith('confirm')

    rerender(<ClearDataDialog stage="confirm" clearing={false} t={t} onStage={onStage} onCancel={onCancel} onConfirm={onConfirm} />)
    const destructive = screen.getByRole('button', { name: 'Clear all data' })
    expect(destructive.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Confirmation text'), { target: { value: 'delete' } })
    expect(destructive.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Confirmation text'), { target: { value: 'DELETE' } })
    expect(destructive.hasAttribute('disabled')).toBe(false)
    fireEvent.click(destructive)
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
