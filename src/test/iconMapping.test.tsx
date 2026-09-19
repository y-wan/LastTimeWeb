import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { importCsv } from '../csv'
import { normalizeIconKey } from '../iconCatalogue'
import { EventIcon } from '../icons'

const mappings = [
  ['宠物日常护理', 'pets'],
  ['更换床品', 'bed'],
  ['汽车补充液体', 'car'],
  ['足部护理', 'grooming'],
  ['手部护理', 'grooming'],
  ['日常理容', 'grooming'],
  ['地面清洁', 'cleaning'],
  ['清洗空调', 'air_conditioner'],
  ['清洁软体家具', 'furniture'],
  ['宠物洗护', 'pets'],
  ['清洁宠物用品', 'cleaning'],
  ['日常淋浴', 'shower'],
  ['清洁空气滤网', 'air'],
  ['清洗洗衣设备', 'laundry']
] as const

describe('Android enriched CSV icon mapping', () => {
  it('preserves and resolves all 14 icon keys to bundled Material Symbols without fallback', () => {
    const csv = ['Event,Icon', ...mappings.map(([event, icon]) => `"${event}","${icon}"`)].join('\n')
    const imported = importCsv(csv)
    expect(imported.events).toHaveLength(14)
    for (const [index, [, expectedIcon]] of mappings.entries()) {
      expect(imported.events[index].icon).toBe(expectedIcon)
      expect(normalizeIconKey(imported.events[index].icon)).toBe(expectedIcon)
      expect(normalizeIconKey(imported.events[index].icon)).not.toBe('clock')
      const markup = renderToStaticMarkup(<EventIcon name={imported.events[index].icon} />)
      expect(markup).toContain(`data-material-symbol="${expectedIcon}"`)
      expect(markup).not.toContain('data-material-symbol="clock"')
    }
  })

  it('keeps legacy web icon keys compatible', () => {
    expect(normalizeIconKey('paw')).toBe('pets')
    expect(normalizeIconKey('scissors')).toBe('grooming')
    expect(normalizeIconKey('air-conditioner')).toBe('air_conditioner')
  })

  it('maps every broader catalogue key explicitly', async () => {
    const { iconCatalogue } = await import('../iconCatalogue')
    for (const icon of iconCatalogue) {
      expect(renderToStaticMarkup(<EventIcon name={icon} />)).toContain(`data-material-symbol="${icon}"`)
    }
  })
})
