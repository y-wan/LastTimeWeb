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

afterEach(cleanup)

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

    expect(screen.getByText(/browser session ended/i)).not.toBeNull()
    expect(screen.getAllByRole('button', { name: 'Reconnect Microsoft' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).toBeNull()
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
      authMock.listener?.({ ready: true, status: 'reconnect-required' })
      return true
    })
    render(<App />)
    await openSettings()

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(authMock.retryAuthRestore).toHaveBeenCalledOnce())
    await waitFor(() => expect(authMock.synchronize).toHaveBeenCalledTimes(2))
    for (const button of screen.getAllByRole('button', { name: 'Reconnect Microsoft' })) {
      expect(button.hasAttribute('disabled')).toBe(false)
    }
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

  it('renders localized reconnect copy', async () => {
    await db.settings.put({ key: 'settings', locale: 'zh-CN', theme: 'system', colorTheme: 'vitalOrange' })
    authMock.snapshot = { ready: true, status: 'reconnect-required' }
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '设置' }))

    expect(screen.getByText(/浏览器登录会话已结束/)).not.toBeNull()
    expect(screen.getAllByRole('button', { name: '重新连接 Microsoft' }).length).toBeGreaterThan(0)
  })
})
