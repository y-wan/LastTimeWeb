import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}
