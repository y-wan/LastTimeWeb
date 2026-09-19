import { expect, test, type Page } from '@playwright/test'

type PaletteMetric = {
  width: number
  height: number
  previewTop: number
  titleTop: number
  baseline: number
  borderWidth: string
  padding: string
}

async function paletteMetrics(page: Page): Promise<PaletteMetric[]> {
  return page.locator('.palette-card').evaluateAll((items) => items.map((item) => {
    const card = item.getBoundingClientRect()
    const preview = item.querySelector<HTMLElement>('.palette-preview')!.getBoundingClientRect()
    const title = item.querySelector<HTMLElement>('.palette-title')!.getBoundingClientRect()
    const baseline = item.querySelector<HTMLElement>('.palette-baseline-probe')!.getBoundingClientRect()
    const style = getComputedStyle(item)
    return {
      width: card.width,
      height: card.height,
      previewTop: preview.top - card.top,
      titleTop: title.top - card.top,
      baseline: baseline.top - card.top,
      borderWidth: style.borderTopWidth,
      padding: style.paddingTop
    }
  }))
}

function expectSameGeometry(actual: PaletteMetric[], expected: PaletteMetric[]) {
  expect(actual).toHaveLength(5)
  actual.forEach((metric, index) => {
    expect(metric.width).toBeCloseTo(expected[index].width, 5)
    expect(metric.height).toBeCloseTo(expected[index].height, 5)
    expect(metric.previewTop).toBeCloseTo(expected[index].previewTop, 5)
    expect(metric.titleTop).toBeCloseTo(expected[index].titleTop, 5)
    expect(metric.baseline).toBeCloseTo(expected[index].baseline, 5)
    expect(metric.borderWidth).toBe('2px')
    expect(metric.padding).toBe('8px')
  })
}

for (const appearance of ['Light', 'Dark'] as const) {
  test(`palette title geometry stays fixed while selecting every card in ${appearance.toLowerCase()} mode`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: appearance, exact: true }).click()

    const cards = page.locator('.palette-card')
    await expect(cards).toHaveCount(5)
    const initial = await paletteMetrics(page)
    expect(new Set(initial.map((metric) => metric.titleTop)).size).toBe(1)
    expect(new Set(initial.map((metric) => metric.baseline)).size).toBe(1)

    for (let index = 0; index < 5; index += 1) {
      await cards.nth(index).click()
      await expect(cards.nth(index)).toHaveClass(/selected/)
      expectSameGeometry(await paletteMetrics(page), initial)
      expect(await cards.locator('.palette-check').count()).toBe(1)
    }

    const creditLinks = page.locator('.about-card .external-link')
    await expect(creditLinks).toHaveCount(2)
    for (let index = 0; index < 2; index += 1) {
      expect((await creditLinks.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44)
    }
    expect(await page.locator('.settings-card').last().getAttribute('class')).toContain('danger-zone')
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    expect(widths[0]).toBeLessThanOrEqual(widths[1])
  })
}
