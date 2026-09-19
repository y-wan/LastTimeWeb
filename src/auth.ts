export interface AuthAccountIdentity {
  homeAccountId: string
  username: string
  name?: string
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
