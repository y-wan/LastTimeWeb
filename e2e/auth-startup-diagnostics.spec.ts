import { expect, test } from '@playwright/test'
import { translations } from '../src/i18n'

const report = JSON.stringify({
  schema: 1, appVersion: '1.0.11',
  msalKeyCookieAtStart: true, cachedAccountBeforeRedirectHandling: false,
  cacheCounts: { encrypted: null, expiredEncrypted: null, unencrypted: null },
  silentMethod: 'acquireTokenSilent', silentFailure: null,
  automaticRedirect: 'returned', automaticRecoverySkipReason: null, outcome: 'connected',
  stagesMs: { initialize: 12, redirectResult: 89, silent: 8, redirectRoundTrip: 2345, returnedAuthProcessing: 109 },
  persistence: 'available',
  beforeRedirect: {
    msalKeyCookieAtStart: false, cachedAccountBeforeRedirectHandling: false,
    silentMethod: 'ssoSilent', silentFailure: 'interaction_required',
    cacheCounts: { encrypted: null, expiredEncrypted: 3, unencrypted: 0 }
  }
}, null, 2)

for (const width of [320, 393]) {
  for (const language of ['en', 'zh-CN'] as const) {
    const labels = translations[language]
    const locale = {
      value: language, settings: labels.settings, title: labels.startupDiagnostics,
      details: labels.showDetails, copy: labels.copyDetails, copied: labels.copied
    }
    test(`startup diagnostics disclosure and copy stay contained at ${width}px in ${locale.value}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 852 })
      await page.addInitScript((language) => {
        localStorage.setItem('last-time-app-locale', language)
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async (text: string) => { sessionStorage.setItem('copied-startup-report', text) } }
        })
      }, locale.value)
      await page.route('**/src/onedrive.ts', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: `
          export const isSyncConfigured = () => true;
          export const subscribeAuth = (listener) => {
            listener({ready:true,status:'disconnected',startupDiagnostics:${JSON.stringify(report)}});
            return () => {};
          };
          export const retryAuthRestore = async () => false;
          export const currentAccount = async () => undefined;
          export const synchronize = async () => undefined;
          export const signIn = async () => undefined;
          export const signOut = async () => undefined;
        `
      }))
      await page.goto('/')
      await page.getByRole('button', { name: locale.settings, exact: true }).click()
      await expect(page.getByText(locale.title, { exact: true })).toBeVisible()
      const notice = page.locator('.notice').filter({ hasText: locale.title })
      await expect(notice.locator('code')).toHaveCount(0)
      await notice.getByRole('button', { name: locale.details, exact: true }).click()
      await expect(notice.locator('code')).toHaveText(report)
      await notice.getByRole('button', { name: locale.copy, exact: true }).click()
      await expect(notice.getByRole('button', { name: locale.copied, exact: true })).toBeVisible()
      expect(await page.evaluate(() => sessionStorage.getItem('copied-startup-report'))).toBe(report)
      const metrics = await notice.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const detail = element.querySelector<HTMLElement>('.notice-detail')!
        return {
          left: bounds.left, right: bounds.right,
          viewport: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          detailWidth: detail.clientWidth, detailScrollWidth: detail.scrollWidth
        }
      })
      expect(metrics.left).toBeGreaterThanOrEqual(0)
      expect(metrics.right).toBeLessThanOrEqual(width)
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport)
      expect(metrics.detailScrollWidth).toBeLessThanOrEqual(metrics.detailWidth)
    })
  }
}
