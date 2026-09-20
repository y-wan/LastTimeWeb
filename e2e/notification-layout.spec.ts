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
