import { expect, test, type Page } from '@playwright/test'

type ScreenshotLocale = 'en' | 'zh-CN'

const records = {
  en: [
    { id: 'plants', name: 'Water the plants', note: 'Living room and balcony', icon: 'plant', color: '#D65A3A', daysAgo: 1 },
    { id: 'bedding', name: 'Change the bedding', note: 'Fresh sheets', icon: 'bed', color: '#3F6FD4', daysAgo: 5 },
    { id: 'filter', name: 'Clean the filter', note: 'Air purifier', icon: 'filter', color: '#0F8C80', daysAgo: 12 }
  ],
  'zh-CN': [
    { id: 'plants', name: '给植物浇水', note: '客厅和阳台', icon: 'plant', color: '#D65A3A', daysAgo: 1 },
    { id: 'bedding', name: '更换床品', note: '换上干净床单', icon: 'bed', color: '#3F6FD4', daysAgo: 5 },
    { id: 'filter', name: '清洁滤网', note: '空气净化器', icon: 'filter', color: '#0F8C80', daysAgo: 12 }
  ]
} satisfies Record<ScreenshotLocale, Array<{
  id: string
  name: string
  note: string
  icon: string
  color: string
  daysAgo: number
}>>

async function seed(page: Page, locale: ScreenshotLocale, theme: 'light' | 'dark') {
  await page.goto('/')
  await expect(page.locator('header h1')).toBeVisible()
  await page.evaluate(async ({ locale, theme, records }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('last-time')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(['events', 'occurrences', 'settings'], 'readwrite')
    const now = new Date()
    transaction.objectStore('events').clear()
    transaction.objectStore('occurrences').clear()
    transaction.objectStore('settings').put({ key: 'settings', locale, theme, colorTheme: 'vitalOrange' })
    for (const record of records) {
      const occurredAt = new Date(now.getTime() - record.daysAgo * 86_400_000).toISOString()
      const timestamp = now.toISOString()
      transaction.objectStore('events').put({
        id: record.id,
        name: record.name,
        note: record.note,
        icon: record.icon,
        color: record.color,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      transaction.objectStore('occurrences').put({
        id: `${record.id}-occurrence`,
        eventId: record.id,
        occurredAt,
        note: '',
        createdAt: timestamp,
        updatedAt: timestamp
      })
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  }, { locale, theme, records: records[locale] })
  await page.reload()
  await expect(page.locator('header h1')).toHaveText(locale === 'zh-CN' ? '上次' : 'Last Time')
}

function outputPath(name: string, locale: ScreenshotLocale) {
  return `docs/images/${name}${locale === 'zh-CN' ? '.zh-CN' : ''}.png`
}

const requestedLocale = process.env.README_SCREENSHOT_LOCALE
const screenshotLocales = (['en', 'zh-CN'] as const).filter((locale) => !requestedLocale || locale === requestedLocale)

for (const locale of screenshotLocales) {
  test(`capture ${locale} README screenshots`, async ({ page }) => {
    await seed(page, locale, 'light')
    await page.screenshot({ path: outputPath('home-light', locale) })

    await seed(page, locale, 'dark')
    await page.getByRole('button', { name: locale === 'zh-CN' ? '添加事项' : 'Add item' }).click()
    await page.getByLabel(locale === 'zh-CN' ? '名称' : 'Name').fill(locale === 'zh-CN' ? '清洗咖啡机' : 'Clean the coffee machine')
    await page.getByLabel(locale === 'zh-CN' ? '备注' : 'Note').fill(locale === 'zh-CN' ? '包括冲煮头和接水盘' : 'Group head and drip tray')
    await page.screenshot({ path: outputPath('editor-dark', locale) })

    await seed(page, locale, 'light')
    await page.getByRole('button', { name: locale === 'zh-CN' ? '设置' : 'Settings', exact: true }).click()
    await page.screenshot({ path: outputPath('settings-light', locale) })

    await page.locator('.about-card').scrollIntoViewIfNeeded()
    await page.screenshot({ path: outputPath('about-light', locale) })
  })
}
