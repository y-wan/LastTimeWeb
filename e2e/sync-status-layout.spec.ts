import { expect, test } from '@playwright/test'

const cases = [
  { locale: 'en', label: 'Checking Microsoft sign-in status…' },
  { locale: 'zh-CN', label: '正在检查 Microsoft 登录状态…' }
] as const

for (const width of [320, 390, 393]) {
  for (const item of cases) {
    test(`checking pill stays centered at ${width}px in ${item.locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 })
      await page.goto('/')
      await page.evaluate(({ locale, label }) => {
        document.documentElement.lang = locale
        const badge = document.querySelector<HTMLElement>('.sync-badge')!
        badge.className = 'sync-badge checking'
        badge.setAttribute('aria-label', label)
        badge.querySelector<HTMLElement>('.sync-badge-label')!.textContent = label
      }, item)

      await expect(page.locator('.sync-badge')).toHaveAccessibleName(item.label)
      await expect(page.locator('.sync-badge-label')).toHaveText(item.label)

      const metrics = await page.locator('.sync-badge').evaluate((badge) => {
        const box = badge.getBoundingClientRect()
        const icon = badge.querySelector<HTMLElement>('.material-icon')!.getBoundingClientRect()
        const label = badge.querySelector<HTMLElement>('.sync-badge-label')!
        const labelBox = label.getBoundingClientRect()
        const groupLeft = Math.min(icon.left, labelBox.left)
        const groupRight = Math.max(icon.right, labelBox.right)
        return {
          badgeCenter: box.left + box.width / 2,
          groupCenter: (groupLeft + groupRight) / 2,
          leftInset: groupLeft - box.left,
          rightInset: box.right - groupRight,
          labelFits: label.scrollWidth <= label.clientWidth,
          badgeRight: box.right,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth
        }
      })

      expect(Math.abs(metrics.badgeCenter - metrics.groupCenter)).toBeLessThanOrEqual(1)
      expect(metrics.leftInset).toBeGreaterThanOrEqual(12)
      expect(metrics.rightInset).toBeGreaterThanOrEqual(12)
      expect(metrics.labelFits).toBe(true)
      expect(metrics.badgeRight).toBeLessThanOrEqual(width)
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
    })
  }
}
