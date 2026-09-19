export interface AuthAccountIdentity {
  homeAccountId: string
  username: string
  name?: string
}

export const COMMON_AUTHORITY = 'https://login.microsoftonline.com/common'

export function resolveCommonAuthority(authority = COMMON_AUTHORITY) {
  const parsed = new URL(authority)
  const path = parsed.pathname.replace(/\/+$/, '')
  if (parsed.origin !== 'https://login.microsoftonline.com' || path !== '/common' || parsed.search || parsed.hash) {
    throw new Error('Organizational and personal Microsoft accounts require the /common authority')
  }
  return COMMON_AUTHORITY
}

export function selectAccount<T>(
  redirectAccount: T | null | undefined,
  activeAccount: T | null | undefined,
  cachedAccounts: T[]
) {
  return redirectAccount ?? activeAccount ?? cachedAccounts[0]
}

export function accountIdentity(account: AuthAccountIdentity) {
  const name = account.name?.trim()
  return {
    primary: name || account.username || account.homeAccountId,
    secondary: name && account.username ? account.username : ''
  }
}

export function rootRedirectUri(origin: string) {
  return new URL('/', origin).toString()
}
