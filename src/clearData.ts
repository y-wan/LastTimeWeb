export class CloudDeletionPendingError extends Error {
  constructor(cause: unknown) {
    super(`Local data was cleared, but OneDrive deletion is pending: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'CloudDeletionPendingError'
  }
}

export async function clearAllDataWorkflow(sync: () => Promise<unknown>, tombstone: () => Promise<unknown>) {
  await sync()
  await tombstone()
  try {
    await sync()
  } catch (error) {
    throw new CloudDeletionPendingError(error)
  }
}

export function canClearAllData(input: {
  authReady: boolean
  signedIn: boolean
  online: boolean
  hasData: boolean
  clearing: boolean
}) {
  return input.authReady && input.signedIn && input.online && input.hasData && !input.clearing
}
