import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncMock = vi.hoisted(() => ({
  synchronize: vi.fn(),
  configured: true
}))

vi.mock('../onedrive', () => ({
  isSyncConfigured: () => syncMock.configured,
  synchronize: syncMock.synchronize
}))

import { useSync } from '../useSync'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  syncMock.configured = true
  syncMock.synchronize.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('sync request presentation', () => {
  it('shows background account-restoration work until it actually completes without announcing success', async () => {
    const operation = deferred<{ accountId: string; completedAt: string } | undefined>()
    syncMock.synchronize.mockReturnValue(operation.promise)
    const { result } = renderHook(() => useSync('account-a'))

    await waitFor(() => expect(result.current.state).toBe('syncing'))
    expect(syncMock.synchronize).toHaveBeenCalledOnce()

    await act(async () => operation.resolve({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:00:00.000Z'
    }))
    expect(result.current.state).toBe('idle')
    expect(result.current.userCompletion).toBeUndefined()
  })

  it('does not let a post-login account transition reset active work to idle', async () => {
    const operation = deferred<{ accountId: string; completedAt: string } | undefined>()
    syncMock.synchronize.mockReturnValue(operation.promise)
    const { result, rerender } = renderHook(
      ({ accountId }: { accountId?: string }) => useSync(accountId),
      { initialProps: { accountId: undefined as string | undefined } }
    )

    rerender({ accountId: 'account-a' })
    await waitFor(() => expect(result.current.state).toBe('syncing'))
    expect(result.current.state).not.toBe('idle')

    await act(async () => operation.resolve({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:00:00.000Z'
    }))
    expect(result.current.state).toBe('idle')
  })

  it('announces one user completion when a manual request joins background work', async () => {
    const operation = deferred<{ accountId: string; completedAt: string } | undefined>()
    syncMock.synchronize.mockReturnValue(operation.promise)
    const { result } = renderHook(() => useSync('account-a'))
    await waitFor(() => expect(result.current.state).toBe('syncing'))

    void result.current.runUser()
    expect(syncMock.synchronize).toHaveBeenCalledOnce()
    expect(result.current.state).toBe('syncing')

    await act(async () => operation.resolve({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:00:00.000Z'
    }))
    expect(result.current.userCompletion).toMatchObject({
      accountId: 'account-a',
      sequence: 1
    })
  })

  it('keeps skipped no-account and offline requests silent', async () => {
    const { result } = renderHook(() => useSync(undefined))
    await act(async () => { await result.current.runUser() })
    expect(syncMock.synchronize).not.toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
    expect(result.current.userCompletion).toBeUndefined()

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await act(async () => { await result.current.runBackground('account-a') })
    expect(syncMock.synchronize).not.toHaveBeenCalled()
    expect(result.current.state).toBe('offline')
  })

  it('propagates required sync failures without announcing completion', async () => {
    syncMock.synchronize.mockRejectedValue(new Error('download failed'))
    const { result } = renderHook(() => useSync('account-a'))

    await waitFor(() => expect(result.current.state).toBe('error'))
    await expect(result.current.runRequired()).rejects.toThrow('download failed')
    expect(result.current.userCompletion).toBeUndefined()
  })

  it('ignores stale completion from a previous account', async () => {
    const first = deferred<{ accountId: string; completedAt: string } | undefined>()
    const second = deferred<{ accountId: string; completedAt: string } | undefined>()
    syncMock.synchronize.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result, rerender } = renderHook(
      ({ accountId }) => useSync(accountId),
      { initialProps: { accountId: 'account-a' } }
    )
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledOnce())

    rerender({ accountId: 'account-b' })
    expect(syncMock.synchronize).toHaveBeenCalledTimes(1)
    await act(async () => first.resolve({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:00:00.000Z'
    }))
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledTimes(2))
    expect(result.current.state).toBe('syncing')

    await act(async () => second.resolve({
      accountId: 'account-b',
      completedAt: '2026-09-20T00:01:00.000Z'
    }))
    expect(result.current.state).toBe('idle')
  })

  it('runs online and visibility requests in the background without completion announcements', async () => {
    syncMock.synchronize.mockResolvedValue({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:00:00.000Z'
    })
    const { result } = renderHook(() => useSync('account-a'))
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledOnce())
    await waitFor(() => expect(result.current.state).toBe('idle'))

    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledTimes(2))

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledTimes(3))
    expect(result.current.userCompletion).toBeUndefined()
  })

  it('debounces mutation requests as background work', async () => {
    syncMock.synchronize.mockResolvedValue({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:00:00.000Z'
    })
    const { result } = renderHook(() => useSync('account-a'))
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledOnce())
    await waitFor(() => expect(result.current.state).toBe('idle'))
    vi.useFakeTimers()

    act(() => {
      result.current.schedule()
      result.current.schedule()
      vi.advanceTimersByTime(499)
    })
    expect(syncMock.synchronize).toHaveBeenCalledOnce()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })
    expect(syncMock.synchronize).toHaveBeenCalledTimes(2)
    expect(result.current.userCompletion).toBeUndefined()
  })

  it('runs a follow-up sync when a mutation lands during active work', async () => {
    const first = deferred<{ accountId: string; completedAt: string } | undefined>()
    syncMock.synchronize
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        accountId: 'account-a',
        completedAt: '2026-09-20T00:01:00.000Z'
      })
    const { result } = renderHook(() => useSync('account-a'))
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledOnce())
    vi.useFakeTimers()

    act(() => {
      result.current.schedule()
      vi.advanceTimersByTime(500)
    })
    expect(syncMock.synchronize).toHaveBeenCalledOnce()
    vi.useRealTimers()

    await act(async () => first.resolve({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:00:00.000Z'
    }))
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledTimes(2))
    expect(result.current.state).toBe('idle')
  })

  it('waits for the mutation follow-up before announcing manual sync completion', async () => {
    const first = deferred<{ accountId: string; completedAt: string } | undefined>()
    const second = deferred<{ accountId: string; completedAt: string } | undefined>()
    syncMock.synchronize.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useSync('account-a'))
    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledOnce())
    vi.useFakeTimers()

    void result.current.runUser()
    act(() => {
      result.current.schedule()
      vi.advanceTimersByTime(500)
    })
    vi.useRealTimers()
    await act(async () => first.resolve({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:00:00.000Z'
    }))

    await waitFor(() => expect(syncMock.synchronize).toHaveBeenCalledTimes(2))
    expect(result.current.state).toBe('syncing')
    expect(result.current.userCompletion).toBeUndefined()

    await act(async () => second.resolve({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:01:00.000Z'
    }))
    expect(result.current.state).toBe('idle')
    expect(result.current.userCompletion).toMatchObject({
      accountId: 'account-a',
      completedAt: '2026-09-20T00:01:00.000Z'
    })
  })
})
