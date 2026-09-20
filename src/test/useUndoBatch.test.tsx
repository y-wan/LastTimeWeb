import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNDO_WINDOW_MS } from '../undoWindow'
import { useUndoBatch } from '../useUndoBatch'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('rolling undo batches', () => {
  it('syncs additions immediately while the ten-second undo window remains open', () => {
    vi.useFakeTimers()
    const onMutation = vi.fn()
    const { result } = renderHook(() => useUndoBatch(vi.fn(), onMutation))

    act(() => result.current.add('occurrence-a'))
    expect(onMutation).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1))
    act(() => result.current.add('occurrence-b'))
    expect(result.current.batch?.occurrenceIds).toEqual(['occurrence-a', 'occurrence-b'])
    expect(onMutation).toHaveBeenCalledTimes(2)

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1))
    expect(result.current.batch).toBeDefined()

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.batch).toBeUndefined()
    expect(onMutation).toHaveBeenCalledTimes(2)
  })

  it('persists before hiding, waits for every deletion, and syncs the compensating change once', async () => {
    const held = deferred()
    const deleteOccurrence = vi.fn()
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValueOnce(undefined)
    const onMutation = vi.fn()
    const enqueue = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useUndoBatch(deleteOccurrence, onMutation, { enqueue }))

    act(() => {
      result.current.add('occurrence-a')
      result.current.add('occurrence-b')
    })
    expect(onMutation).toHaveBeenCalledTimes(2)
    onMutation.mockClear()

    act(() => result.current.undo())
    expect(result.current.batch).toBeUndefined()
    expect(enqueue).toHaveBeenCalledWith(['occurrence-a', 'occurrence-b'])
    await waitFor(() => expect(result.current.pendingDeletionIds).toEqual(['occurrence-a', 'occurrence-b']))
    expect(deleteOccurrence).toHaveBeenCalledTimes(2)
    expect(onMutation).not.toHaveBeenCalled()

    await act(async () => held.resolve())
    await waitFor(() => expect(onMutation).toHaveBeenCalledOnce())
    expect(result.current.pendingDeletionIds).toEqual([])
  })

  it('restores failed occurrence IDs after optimistic hiding and keeps successful deletions complete', async () => {
    const deleteOccurrence = vi.fn(async (occurrenceId: string) => {
      if (occurrenceId === 'occurrence-b') throw new Error('database unavailable')
    })
    const onMutation = vi.fn()
    const cancel = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useUndoBatch(deleteOccurrence, onMutation, {
      enqueue: vi.fn().mockResolvedValue(undefined),
      cancel
    }))

    act(() => result.current.add('occurrence-a'))
    act(() => result.current.add('occurrence-b'))
    onMutation.mockClear()
    act(() => result.current.undo())
    await waitFor(() => expect(deleteOccurrence).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.failures).toEqual([
      { occurrenceId: 'occurrence-b', detail: 'database unavailable', restored: true }
    ]))
    expect(cancel).toHaveBeenCalledWith('occurrence-b')
    expect(result.current.pendingDeletionIds).toEqual([])
    expect(onMutation).toHaveBeenCalledOnce()
  })

  it('resumes persisted undo work after remount', async () => {
    const held = deferred()
    const applyDeletion = vi.fn(() => held.promise)
    const onMutation = vi.fn()
    const { result } = renderHook(() => useUndoBatch(applyDeletion, onMutation, {
      pendingDeletionIds: ['occurrence-a'],
      cancel: vi.fn().mockResolvedValue(undefined)
    }))

    expect(result.current.pendingDeletionIds).toEqual(['occurrence-a'])
    await waitFor(() => expect(applyDeletion).toHaveBeenCalledWith('occurrence-a'))

    await act(async () => held.resolve())
    await waitFor(() => expect(onMutation).toHaveBeenCalledOnce())
  })

  it('does not let an older batch completion clear a newer batch', async () => {
    const oldDeletion = deferred()
    const deleteOccurrence = vi.fn()
      .mockImplementationOnce(() => oldDeletion.promise)
      .mockResolvedValueOnce(undefined)
    const onMutation = vi.fn()
    const { result } = renderHook(() => useUndoBatch(deleteOccurrence, onMutation))

    act(() => {
      result.current.add('occurrence-old')
      result.current.undo()
      result.current.add('occurrence-new')
    })
    expect(result.current.batch?.occurrenceIds).toEqual(['occurrence-new'])
    expect(onMutation).toHaveBeenCalledTimes(2)

    await act(async () => oldDeletion.resolve())
    await waitFor(() => expect(onMutation).toHaveBeenCalledTimes(3))
    expect(result.current.batch?.occurrenceIds).toEqual(['occurrence-new'])
  })

  it('retries a failed occurrence independently and schedules after success', async () => {
    const deleteOccurrence = vi.fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(undefined)
    const onMutation = vi.fn()
    const { result } = renderHook(() => useUndoBatch(deleteOccurrence, onMutation))

    act(() => result.current.add('occurrence-a'))
    onMutation.mockClear()
    act(() => result.current.undo())
    await waitFor(() => expect(result.current.failures).toHaveLength(1))
    expect(onMutation).not.toHaveBeenCalled()
    onMutation.mockClear()

    await act(async () => result.current.retryFailure('occurrence-a'))
    expect(result.current.failures).toEqual([])
    expect(onMutation).toHaveBeenCalledOnce()
  })
})
