import { expect, test } from '@playwright/test'

test('long update details stay contained and disclosure remains operable', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const { updateStore } = await import('/src/updateStore.ts')
    updateStore.setAvailable()
    updateStore.setError(`UpdateFailure:${'UnbrokenTechnicalDetail'.repeat(40)}`)
  })

  const notice = page.getByRole('alert')
  await expect(notice).toContainText('Update failed. Try again.')
  await expect(notice).not.toContainText('UnbrokenTechnicalDetail')
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible()

  await page.getByRole('button', { name: 'Show details' }).click()
  await expect(notice).toContainText('UnbrokenTechnicalDetail')
  await expect(page.getByRole('button', { name: 'Update now' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  const box = await notice.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(393)

  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notice).toHaveCount(0)

  await page.evaluate(async () => {
    const { updateStore } = await import('/src/updateStore.ts')
    updateStore.setApplying()
    updateStore.setError('A later failure')
  })
  await expect(page.getByRole('alert')).toContainText('Update failed. Try again.')
  await expect(page.getByRole('button', { name: 'Show details' })).toBeVisible()
})

for (const locale of [
  {
    name: 'English',
    switchLabel: 'Settings',
    languageLabel: 'English',
    summary: 'Could not check or download the update. Check your connection and try again.',
    details: 'Show details'
  },
  {
    name: 'Simplified Chinese',
    switchLabel: 'Settings',
    languageLabel: '简体中文',
    summary: '无法检查或下载更新，请检查网络后重试。',
    details: '查看详情'
  }
]) {
  test(`background update failure stays silent and explicit failure is localized in ${locale.name}`, async ({ page }) => {
    await page.goto('/')
    if (locale.languageLabel === '简体中文') {
      await page.getByRole('button', { name: locale.switchLabel }).click()
      await page.getByRole('button', { name: locale.languageLabel }).click()
    }

    await page.evaluate(async () => {
      const { updateStore } = await import('/src/updateStore.ts')
      updateStore.recordBackgroundNetworkFailure()
    })
    await expect(page.getByRole('alert')).toHaveCount(0)

    await page.evaluate(async () => {
      const { updateStore } = await import('/src/updateStore.ts')
      updateStore.setAvailable()
      updateStore.setError(
        "Failed to update a ServiceWorker for scope ('https://example/') with script ('https://example/sw.js'): An unknown error occurred when fetching the script.",
        'network'
      )
    })

    await expect(page.getByRole('alert')).toContainText(locale.summary)
    await expect(page.getByRole('alert')).not.toContainText('unknown error')
    await page.getByRole('button', { name: locale.details }).click()
    await expect(page.getByRole('alert')).toContainText('unknown error')
  })
}
