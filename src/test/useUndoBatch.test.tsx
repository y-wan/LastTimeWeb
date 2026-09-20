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
  it('joins additions, resets the ten-second window, and finalizes once', () => {
    vi.useFakeTimers()
    const finalize = vi.fn()
    const { result } = renderHook(() => useUndoBatch(vi.fn(), finalize))

    act(() => result.current.add('occurrence-a'))
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1))
    act(() => result.current.add('occurrence-b'))
    expect(result.current.batch?.occurrenceIds).toEqual(['occurrence-a', 'occurrence-b'])

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1))
    expect(result.current.batch).toBeDefined()
    expect(finalize).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.batch).toBeUndefined()
    expect(finalize).toHaveBeenCalledOnce()
  })

  it('hides synchronously, waits for every deletion, and schedules once', async () => {
    const held = deferred()
    const deleteOccurrence = vi.fn()
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValueOnce(undefined)
    const finalize = vi.fn()
    const { result } = renderHook(() => useUndoBatch(deleteOccurrence, finalize))

    act(() => {
      result.current.add('occurrence-a')
      result.current.add('occurrence-b')
      result.current.undo()
    })
    expect(result.current.batch).toBeUndefined()
    expect(deleteOccurrence).toHaveBeenCalledTimes(2)
    expect(finalize).not.toHaveBeenCalled()

    await act(async () => held.resolve())
    await waitFor(() => expect(finalize).toHaveBeenCalledOnce())
  })

  it('retains only failed occurrence IDs and keeps successful deletions complete', async () => {
    const deleteOccurrence = vi.fn(async (occurrenceId: string) => {
      if (occurrenceId === 'occurrence-b') throw new Error('database unavailable')
    })
    const finalize = vi.fn()
    const { result } = renderHook(() => useUndoBatch(deleteOccurrence, finalize))

    act(() => {
      result.current.add('occurrence-a')
      result.current.add('occurrence-b')
      result.current.undo()
    })
    await waitFor(() => expect(result.current.failures).toEqual([
      { occurrenceId: 'occurrence-b', detail: 'database unavailable' }
    ]))
    expect(finalize).toHaveBeenCalledOnce()
  })

  it('does not let an older batch completion clear a newer batch', async () => {
    const oldDeletion = deferred()
    const deleteOccurrence = vi.fn()
      .mockImplementationOnce(() => oldDeletion.promise)
      .mockResolvedValueOnce(undefined)
    const finalize = vi.fn()
    const { result } = renderHook(() => useUndoBatch(deleteOccurrence, finalize))

    act(() => {
      result.current.add('occurrence-old')
      result.current.undo()
      result.current.add('occurrence-new')
    })
    expect(result.current.batch?.occurrenceIds).toEqual(['occurrence-new'])

    await act(async () => oldDeletion.resolve())
    await waitFor(() => expect(finalize).toHaveBeenCalledOnce())
    expect(result.current.batch?.occurrenceIds).toEqual(['occurrence-new'])
  })

  it('retries a failed occurrence independently and schedules after success', async () => {
    const deleteOccurrence = vi.fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(undefined)
    const finalize = vi.fn()
    const { result } = renderHook(() => useUndoBatch(deleteOccurrence, finalize))

    act(() => {
      result.current.add('occurrence-a')
      result.current.undo()
    })
    await waitFor(() => expect(result.current.failures).toHaveLength(1))

    await act(async () => result.current.retryFailure('occurrence-a'))
    expect(result.current.failures).toEqual([])
    expect(finalize).toHaveBeenCalledTimes(2)
  })
})
