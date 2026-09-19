import { expect, test } from '@playwright/test'

for (const scenario of [
  { locale: 'zh-CN', language: 'zh-CN', name: '上次', manifest: 'manifest.zh-CN.webmanifest' },
  { locale: 'en-US', language: 'en', name: 'Last Time', manifest: 'manifest.en.webmanifest' }
] as const) {
  test(`selects ${scenario.locale} install metadata before app startup`, async ({ browser }) => {
    const context = await browser.newContext({ locale: scenario.locale })
    const page = await context.newPage()
    await page.route('**/src/main.tsx', (route) => route.abort())
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('html')).toHaveAttribute('lang', scenario.language)
    await expect(page).toHaveTitle(scenario.name)
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', scenario.name)

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(manifestHref).toBe(`./${scenario.manifest}`)
    const manifest = await page.evaluate(async (href) => {
      const response = await fetch(href!)
      return response.json() as Promise<{ id: string; name: string; short_name: string }>
    }, manifestHref)
    expect(manifest).toMatchObject({ id: './', name: scenario.name, short_name: scenario.name })

    await context.close()
  })
}
