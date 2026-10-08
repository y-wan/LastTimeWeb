import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSnapshot } from '../authSession'
import { db } from '../db'

const authMock = vi.hoisted(() => ({
  snapshot: { ready: true, status: 'disconnected' } as AuthSnapshot,
  synchronize: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  retryAuthRestore: vi.fn(),
  listener: undefined as ((snapshot: AuthSnapshot) => void) | undefined
}))

vi.mock('../onedrive', () => ({
  isSyncConfigured: () => true,
  subscribeAuth: (listener: (snapshot: AuthSnapshot) => void) => {
    authMock.listener = listener
    listener(authMock.snapshot)
    return () => {}
  },
  synchronize: authMock.synchronize,
  signIn: authMock.signIn,
  signOut: authMock.signOut,
  retryAuthRestore: authMock.retryAuthRestore
}))

import App from '../App'

beforeEach(async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  authMock.snapshot = { ready: true, status: 'disconnected' }
  authMock.synchronize.mockReset().mockResolvedValue(undefined)
  authMock.signIn.mockReset().mockResolvedValue(undefined)
  authMock.signOut.mockReset().mockResolvedValue(undefined)
  authMock.retryAuthRestore.mockReset().mockResolvedValue(false)
  authMock.listener = undefined
  await db.events.clear()
  await db.occurrences.clear()
  await db.settings.clear()
  await db.syncMeta.clear()
  await db.microsoftAuthState.clear()
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'visibilityState')
})

async function openSettings() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
}

describe('Microsoft cold-start UI', () => {
  it('continues normal automatic sync after silent restoration connects an account', async () => {
    authMock.snapshot = {
      ready: true,
      status: 'connected',
      account: {
        homeAccountId: 'home-account',
        environment: 'login.microsoftonline.com',
        tenantId: 'tenant',
        username: 'person@example.com',
        localAccountId: 'local-account'
      }
    }
    authMock.synchronize.mockResolvedValue({
      accountId: 'home-account',
      completedAt: '2026-09-20T00:00:00.000Z'
    })

    render(<App />)

    await waitFor(() => expect(authMock.synchronize).toHaveBeenCalled())
    expect(authMock.signIn).not.toHaveBeenCalled()
  })

  it('distinguishes reconnect-required from first-time connection', async () => {
    authMock.snapshot = { ready: true, status: 'reconnect-required' }
    render(<App />)
    await openSettings()

    expect(screen.getByText(/authorization needs to be renewed/i)).not.toBeNull()
    expect(screen.getAllByRole('button', { name: 'Reconnect Microsoft' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull()
  })

  it('does not claim a successful connection or start sync before redirect returns', async () => {
    authMock.snapshot = { ready: true, status: 'reconnect-required' }
    authMock.signIn.mockResolvedValue(undefined)
    render(<App />)
    await openSettings()

    fireEvent.click(screen.getAllByRole('button', { name: 'Reconnect Microsoft' })[0])

    await waitFor(() => expect(authMock.signIn).toHaveBeenCalledOnce())
    expect(authMock.synchronize).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Reconnect Microsoft' }).length).toBeGreaterThan(0)
  })

  it('keeps an offline reconnect truthful and disabled', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    authMock.snapshot = { ready: true, status: 'reconnect-required', offline: true }
    render(<App />)
    await openSettings()

    expect(screen.getByText(/You’re offline/)).not.toBeNull()
    for (const button of screen.getAllByRole('button', { name: 'Reconnect Microsoft' })) {
      expect(button.hasAttribute('disabled')).toBe(true)
    }
  })

  it('retries silent restoration and normal sync when connectivity returns', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    authMock.snapshot = { ready: true, status: 'reconnect-required', offline: true }
    authMock.retryAuthRestore.mockImplementation(async () => {
      authMock.listener?.({
        ready: true,
        status: 'connected',
        account: {
          homeAccountId: 'home-account',
          environment: 'login.microsoftonline.com',
          tenantId: 'tenant',
          username: 'person@example.com',
          localAccountId: 'local-account'
        }
      })
      return true
    })
    render(<App />)
    await openSettings()

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(authMock.retryAuthRestore).toHaveBeenCalledOnce())
    await waitFor(() => expect(authMock.synchronize).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Reconnect Microsoft' })).toBeNull()
  })

  it('keeps first-use connection and restoring copy distinct', async () => {
    render(<App />)
    await openSettings()
    expect(screen.getAllByRole('button', { name: 'Sign in with Microsoft' }).length).toBeGreaterThan(0)
    cleanup()

    authMock.snapshot = { ready: false, status: 'restoring' }
    render(<App />)
    await openSettings()
    expect(screen.getByText('Restoring Microsoft connection…')).not.toBeNull()
  })

  it('offers silent retry with visible error details instead of claiming sign-out', async () => {
    authMock.snapshot = { ready: true, status: 'restore-failed', error: 'network failed' }
    render(<App />)
    await openSettings()

    expect(screen.getByText(/Could not restore Microsoft connection/)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByText('network failed')).not.toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await waitFor(() => expect(authMock.retryAuthRestore).toHaveBeenCalledOnce())
    expect(authMock.signIn).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Microsoft' }))
    await waitFor(() => expect(authMock.signIn).toHaveBeenCalledOnce())
  })

  it('silently restores on foreground resume and resumes normal sync', async () => {
    authMock.snapshot = { ready: true, status: 'restore-failed', error: 'network failed' }
    authMock.retryAuthRestore.mockImplementation(async () => {
      authMock.listener?.({
        ready: true,
        status: 'connected',
        account: {
          homeAccountId: 'home-account',
          environment: 'login.microsoftonline.com',
          tenantId: 'tenant',
          username: 'person@example.com',
          localAccountId: 'local-account'
        }
      })
      return true
    })
    render(<App />)
    await openSettings()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    fireEvent(document, new Event('visibilitychange'))
    expect(authMock.retryAuthRestore).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => expect(authMock.retryAuthRestore).toHaveBeenCalledOnce())
    await waitFor(() => expect(authMock.synchronize).toHaveBeenCalledOnce())
    expect(authMock.signIn).not.toHaveBeenCalled()
    expect(screen.queryByText(/Could not restore Microsoft connection/)).toBeNull()
  })

  it('disables retry and reconnect while a failed restoration is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    authMock.snapshot = { ready: true, status: 'restore-failed', error: 'network failed' }
    render(<App />)
    await openSettings()

    expect(screen.getByText(/You’re offline/)).not.toBeNull()
    for (const button of [
      ...screen.getAllByRole('button', { name: 'Retry' }),
      screen.getByRole('button', { name: 'Reconnect Microsoft' })
    ]) {
      expect(button.hasAttribute('disabled')).toBe(true)
    }
    expect(authMock.signIn).not.toHaveBeenCalled()
  })

  it('renders localized retryable restoration copy', async () => {
    await db.settings.put({ key: 'settings', locale: 'zh-CN', theme: 'system', colorTheme: 'vitalOrange' })
    authMock.snapshot = { ready: true, status: 'restore-failed', error: 'network failed' }
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '设置' }))

    expect(screen.getByText(/无法恢复 Microsoft 连接，请先重试/)).not.toBeNull()
    expect(screen.getAllByRole('button', { name: '重试' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重新连接 Microsoft' })).not.toBeNull()
  })

  it('renders localized reconnect copy', async () => {
    await db.settings.put({ key: 'settings', locale: 'zh-CN', theme: 'system', colorTheme: 'vitalOrange' })
    authMock.snapshot = { ready: true, status: 'reconnect-required' }
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '设置' }))

    expect(screen.getByText(/Microsoft 授权需要更新/)).not.toBeNull()
    expect(screen.getAllByRole('button', { name: '重新连接 Microsoft' }).length).toBeGreaterThan(0)
  })
})
