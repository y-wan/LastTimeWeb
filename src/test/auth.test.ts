import { describe, expect, it } from 'vitest'
import { accountIdentity, COMMON_AUTHORITY, isIphoneStandalonePwa, isIosStandalonePwa, resolveCommonAuthority, rootRedirectUri, selectAccount } from '../auth'

describe('Microsoft account restoration', () => {
  it('prefers redirect, then active, then cached accounts', () => {
    const redirected = { id: 'redirected' }
    const active = { id: 'active' }
    const cached = { id: 'cached' }
    expect(selectAccount(redirected, active, [cached])).toBe(redirected)
    expect(selectAccount(undefined, active, [cached])).toBe(active)
    expect(selectAccount(undefined, undefined, [cached])).toBe(cached)
  })

  it('shows a personal account name and email without hiding either', () => {
    expect(accountIdentity({ homeAccountId: '1', name: 'Taylor', username: 'taylor@example.com' })).toEqual({
      primary: 'Taylor',
      secondary: 'taylor@example.com'
    })
  })

  it('uses the workers.dev origin root as the redirect URI', () => {
    expect(rootRedirectUri('https://lasttimeweb.example.workers.dev')).toBe('https://lasttimeweb.example.workers.dev/')
  })

  it('uses common for the organizational-and-personal audience', () => {
    expect(resolveCommonAuthority()).toBe(COMMON_AUTHORITY)
    expect(COMMON_AUTHORITY).toBe('https://login.microsoftonline.com/common')
    expect(() => resolveCommonAuthority('https://login.microsoftonline.com/consumers')).toThrow('/common')
  })

  it('uses redirect only for the iOS Home Screen context, not a normal browser', () => {
    expect(isIosStandalonePwa({ standalone: true })).toBe(true)
    expect(isIosStandalonePwa({ standalone: false })).toBe(false)
    expect(isIosStandalonePwa({})).toBe(false)
  })

  it('limits automatic recovery to an installed iPhone app', () => {
    expect(isIphoneStandalonePwa({ standalone: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true)
    for (const browser of [
      { standalone: false, userAgent: 'iPhone' },
      { userAgent: 'iPhone' },
      { standalone: true, userAgent: 'iPad' },
      { standalone: true, userAgent: 'Macintosh' },
      { standalone: true, userAgent: 'Android' },
      { standalone: true }
    ]) expect(isIphoneStandalonePwa(browser)).toBe(false)
  })
})
