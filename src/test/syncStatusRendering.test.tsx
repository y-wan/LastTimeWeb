import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectedAccountSummary, SyncBadge } from '../App'
import { translator } from '../i18n'
import { syncStatusLabel, type SyncPresentation } from '../syncStatus'
import type { Locale } from '../types'

afterEach(() => cleanup())

describe('sync status rendering', () => {
  for (const locale of ['en', 'zh-CN'] as const satisfies readonly Locale[]) {
    for (const status of ['notSynced', 'syncing', 'synced', 'offline', 'error'] as const satisfies readonly SyncPresentation[]) {
      it(`renders ${status} exactly once in ${locale}`, () => {
        const t = translator(locale)
        render(<>
          <SyncBadge status={status} error="" t={t} />
          <ConnectedAccountSummary
            identity={{ primary: 'Example account', secondary: '' }}
            lastSuccessfulSyncAt={status === 'synced' ? '2026-09-19T08:00:00.000Z' : undefined}
            locale={locale}
            t={t}
          />
        </>)

        expect(screen.getAllByText(syncStatusLabel(status, t), { exact: true })).toHaveLength(1)
      })
    }
  }

  it('does not repeat the unsynced label as a last-sync value', () => {
    const t = translator('zh-CN')
    render(<>
      <SyncBadge status="notSynced" error="" t={t} />
      <ConnectedAccountSummary
        identity={{ primary: 'Example account', secondary: '' }}
        locale="zh-CN"
        t={t}
      />
    </>)

    expect(screen.getAllByText('尚未同步', { exact: true })).toHaveLength(1)
    expect(screen.queryByText('上次同步', { exact: false })).toBeNull()
  })
})
