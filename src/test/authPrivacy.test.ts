import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { localDocument } from '../onedrive'

beforeEach(async () => {
  await db.events.clear()
  await db.occurrences.clear()
  await db.microsoftAuthState.clear()
})

describe('local Microsoft recovery privacy', () => {
  it('never serializes the marker or login hint into the OneDrive document', async () => {
    await db.microsoftAuthState.put({
      key: 'microsoft',
      connectedBefore: true,
      loginHint: 'private-person@example.com'
    })

    const serialized = JSON.stringify(await localDocument())
    expect(serialized).not.toContain('private-person@example.com')
    expect(serialized).not.toContain('connectedBefore')
    expect(Object.keys(JSON.parse(serialized))).toEqual(['version', 'updatedAt', 'events', 'occurrences'])
  })
})
