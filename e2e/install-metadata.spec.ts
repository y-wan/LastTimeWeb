import { expect, test } from '@playwright/test'

async function expectActiveManifest(page: import('@playwright/test').Page, file: string, name: string) {
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBe(`./${file}`)
  const manifest = await page.evaluate(async (href) => {
    const response = await fetch(href!)
    return response.json() as Promise<{ id: string; name: string; short_name: string }>
  }, manifestHref)
  expect(manifest).toMatchObject({ id: './', name, short_name: name })
}

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
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      'https://lasttimeweb.feliciameow.workers.dev/apple-touch-icon-20260919.png'
    )
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '180x180')
    await expectActiveManifest(page, scenario.manifest, scenario.name)

    await context.close()
  })
}

test('explicit Chinese app language overrides an English browser signal and survives parser-time reload', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' })
  const page = await context.newPage()
  await page.goto('/')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: '简体中文', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page).toHaveTitle('上次')
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', '上次')
  await expectActiveManifest(page, 'manifest.zh-CN.webmanifest', '上次')

  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('last-time')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const locale = await new Promise<string | undefined>((resolve, reject) => {
      const request = database.transaction('settings').objectStore('settings').get('settings')
      request.onsuccess = () => resolve(request.result?.locale)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return locale
  })).toBe('zh-CN')

  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expectActiveManifest(page, 'manifest.zh-CN.webmanifest', '上次')

  await page.route('**/src/main.tsx', (route) => route.abort())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page).toHaveTitle('上次')
  await expectActiveManifest(page, 'manifest.zh-CN.webmanifest', '上次')

  await context.close()
})
