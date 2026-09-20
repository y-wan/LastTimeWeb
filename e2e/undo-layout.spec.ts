import { expect, test } from '@playwright/test'

const locales = [
  { locale: 'en', message: '2 records added', action: 'Undo all' },
  { locale: 'zh-CN', message: '已添加 2 条记录', action: '全部撤销' }
] as const

for (const width of [320, 390, 393]) {
  for (const item of locales) {
    test(`batch undo stays contained at ${width}px in ${item.locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 })
      await page.goto('/')
      await page.evaluate(({ locale }) => {
        document.documentElement.lang = locale
        const toast = document.createElement('div')
        toast.className = 'toast undo-toast'
        toast.setAttribute('role', 'status')
        const message = document.createElement('span')
        message.className = 'notice-message'
        message.textContent = locale === 'zh-CN' ? '已添加 2 条记录' : '2 records added'
        const button = document.createElement('button')
        button.textContent = locale === 'zh-CN' ? '全部撤销' : 'Undo all'
        toast.append(message, button)
        document.querySelector('.app-shell')!.append(toast)
      }, item)

      await expect(page.getByRole('status')).toContainText(item.message)
      await expect(page.getByRole('button', { name: item.action })).toBeVisible()
      const metrics = await page.getByRole('status').evaluate((toast) => {
        const box = toast.getBoundingClientRect()
        return {
          left: box.left,
          right: box.right,
          messageFits: toast.querySelector<HTMLElement>('.notice-message')!.scrollWidth <=
            toast.querySelector<HTMLElement>('.notice-message')!.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth
        }
      })
      expect(metrics.left).toBeGreaterThanOrEqual(14)
      expect(metrics.right).toBeLessThanOrEqual(width - 14)
      expect(metrics.messageFits).toBe(true)
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth)
    })
  }
}
