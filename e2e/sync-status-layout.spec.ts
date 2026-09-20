import { expect, test } from '@playwright/test'

const cases = [
  {
    locale: 'en',
    labels: {
      checking: 'Checking Microsoft sign-in status…',
      deviceOnly: 'Saved on this device only',
      notSynced: 'Not synced yet',
      syncing: 'Syncing…',
      synced: 'Synced',
      offline: 'Offline, waiting to sync',
      error: 'Sync error'
    }
  },
  {
    locale: 'zh-CN',
    labels: {
      checking: '正在检查 Microsoft 登录状态…',
      deviceOnly: '仅保存在此设备',
      notSynced: '尚未同步',
      syncing: '同步中…',
      synced: '已同步',
      offline: '离线，等待同步',
      error: '同步错误'
    }
  }
] as const

for (const width of [320, 360, 390, 393]) {
  for (const item of cases) {
    for (const [status, label] of Object.entries(item.labels)) {
      test(`${status} pill stays contained at ${width}px in ${item.locale}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 852 })
        await page.goto('/')
        await page.evaluate(({ locale, status, label }) => {
          document.documentElement.lang = locale
          const control = document.querySelector<HTMLElement>('.sync-control')!
          const badge = document.querySelector<HTMLElement>('.sync-badge')!
          control.dataset.status = status
          badge.className = `sync-badge ${status}`
          badge.setAttribute('aria-label', label)
          badge.querySelector<HTMLElement>('.sync-badge-label')!.textContent = label
        }, { locale: item.locale, status, label })

        await expect(page.locator('.sync-badge')).toHaveAccessibleName(label)
        await expect(page.locator('.sync-badge-label')).toHaveText(label)

        const metrics = await page.locator('.sync-badge').evaluate((badge) => {
          const header = badge.closest('header')!
          const control = badge.closest<HTMLElement>('.sync-control')!
          const copy = header.firstElementChild!.getBoundingClientRect()
          const headerBox = header.getBoundingClientRect()
          const headerStyle = getComputedStyle(header)
          const badgeStyle = getComputedStyle(badge)
          const contentLeft = headerBox.left + parseFloat(headerStyle.paddingLeft)
          const contentRight = headerBox.right - parseFloat(headerStyle.paddingRight)
          const box = badge.getBoundingClientRect()
          const controlBox = control.getBoundingClientRect()
          const icon = badge.querySelector<HTMLElement>('.material-icon')!.getBoundingClientRect()
          const labelElement = badge.querySelector<HTMLElement>('.sync-badge-label')!
          const labelBox = labelElement.getBoundingClientRect()
          const groupLeft = Math.min(icon.left, labelBox.left)
          const groupRight = Math.max(icon.right, labelBox.right)
          const overlapsCopy = !(
            box.right <= copy.left ||
            box.left >= copy.right ||
            box.bottom <= copy.top ||
            box.top >= copy.bottom
          )
          return {
            badgeCenter: box.left + box.width / 2,
            badgeLeft: box.left,
            badgeRight: box.right,
            badgeTop: box.top,
            badgeHeight: box.height,
            badgeWidth: box.width,
            leftRadius: parseFloat(badgeStyle.borderTopLeftRadius),
            rightRadius: parseFloat(badgeStyle.borderTopRightRadius),
            contentCenter: (contentLeft + contentRight) / 2,
            contentLeft,
            contentRight,
            controlLeft: controlBox.left,
            controlRight: controlBox.right,
            copyBottom: copy.bottom,
            groupCenter: (groupLeft + groupRight) / 2,
            groupWidth: groupRight - groupLeft,
            leftInset: groupLeft - box.left,
            rightInset: box.right - groupRight,
            labelFits: labelElement.scrollWidth <= labelElement.clientWidth,
            overlapsCopy,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: document.documentElement.clientWidth
          }
        })

        expect(Math.abs(metrics.badgeCenter - metrics.groupCenter)).toBeLessThanOrEqual(1)
        expect(metrics.leftInset).toBeGreaterThanOrEqual(12)
        expect(metrics.rightInset).toBeGreaterThanOrEqual(12)
        expect(metrics.badgeWidth - metrics.groupWidth).toBeLessThanOrEqual(25)
        expect(metrics.leftRadius).toBeGreaterThanOrEqual(metrics.badgeHeight / 2)
        expect(metrics.rightRadius).toBeGreaterThanOrEqual(metrics.badgeHeight / 2)
        expect(metrics.labelFits).toBe(true)
        expect(metrics.overlapsCopy).toBe(false)
        expect(metrics.badgeLeft).toBeGreaterThanOrEqual(metrics.contentLeft)
        expect(metrics.badgeRight).toBeLessThanOrEqual(metrics.contentRight)
        expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)

        if (status === 'checking') {
          expect(Math.abs(metrics.controlLeft - metrics.contentLeft)).toBeLessThanOrEqual(1)
          expect(Math.abs(metrics.controlRight - metrics.contentRight)).toBeLessThanOrEqual(1)
          expect(Math.abs(metrics.badgeCenter - metrics.contentCenter)).toBeLessThanOrEqual(1)
          expect(metrics.copyBottom).toBeLessThan(metrics.badgeTop)
        } else {
          expect(Math.abs(metrics.badgeRight - metrics.contentRight)).toBeLessThanOrEqual(1)
        }
      })
    }
  }
}
