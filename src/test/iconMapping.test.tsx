import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { importCsv } from '../csv'
import { iconCatalogue, normalizeIconKey } from '../iconCatalogue'
import { EventIcon } from '../icons'

const mappings = [
  ['宠物日常护理', 'pets', '#9A5A78'],
  ['更换床品', 'bed', '#E86F51'],
  ['汽车补充液体', 'car', '#4D73BE'],
  ['足部护理', 'grooming', '#F2A65A'],
  ['手部护理', 'grooming', '#F2A65A'],
  ['日常理容', 'grooming', '#F2A65A'],
  ['地面清洁', 'cleaning', '#238C82'],
  ['清洗空调', 'air_conditioner', '#4D73BE'],
  ['清洁软体家具', 'furniture', '#E86F51'],
  ['宠物洗护', 'pets', '#9A5A78'],
  ['清洁宠物用品', 'cleaning', '#238C82'],
  ['日常淋浴', 'shower', '#E86F51'],
  ['清洁空气滤网', 'air', '#238C82'],
  ['清洗洗衣设备', 'laundry', '#4D73BE']
] as const

describe('Android enriched CSV icon mapping', () => {
  it('preserves and resolves all 14 icon keys to bundled Material Symbols without fallback', async () => {
    const csv = ['Event,Icon,Color', ...mappings.map(([event, icon, color]) => `"${event}","${icon}","${color}"`)].join('\n')
    const imported = await importCsv(csv)
    expect(imported.events).toHaveLength(14)
    for (const [index, [, expectedIcon, expectedColor]] of mappings.entries()) {
      expect(imported.events[index].icon).toBe(expectedIcon)
      expect(imported.events[index].color).toBe(expectedColor)
      expect(normalizeIconKey(imported.events[index].icon)).toBe(expectedIcon)
      expect(normalizeIconKey(imported.events[index].icon)).not.toBe('clock')
      const markup = renderToStaticMarkup(<EventIcon name={imported.events[index].icon} />)
      expect(markup).toContain(`data-material-symbol="${expectedIcon}"`)
      expect(markup).not.toContain('data-material-symbol="clock"')
    }
  })

  it('keeps legacy web icon keys compatible', () => {
    const aliases = {
      clock: 'event', general: 'event', routine: 'history', social: 'celebration',
      paw: 'pets', dog: 'pets', cat: 'pets', bone: 'pets', scissors: 'grooming',
      'air-conditioner': 'air_conditioner', bath: 'shower', food: 'meal',
      exercise: 'fitness', clothes: 'laundry', plants: 'home', spray: 'cleaning'
    } as const
    for (const [alias, canonical] of Object.entries(aliases)) {
      expect(normalizeIconKey(alias)).toBe(canonical)
      expect(renderToStaticMarkup(<EventIcon name={alias} />)).toContain(`data-material-symbol="${canonical}"`)
    }
  })

  it('matches the complete Android stable-key catalogue and maps every key explicitly', () => {
    expect(iconCatalogue).toEqual([
      'event', 'history', 'favorite', 'health', 'medical', 'medication', 'fitness',
      'running', 'cycling', 'sleep', 'mindfulness', 'water', 'meal', 'coffee', 'pets',
      'family', 'children', 'friends', 'call', 'book', 'movie', 'music', 'travel',
      'car', 'home', 'cleaning', 'work', 'study', 'shopping', 'payment', 'celebration',
      'birthday', 'creative', 'quit_smoking', 'punctuality', 'bed', 'grooming',
      'air_conditioner', 'furniture', 'shower', 'air', 'laundry'
    ])
    for (const icon of iconCatalogue) {
      expect(renderToStaticMarkup(<EventIcon name={icon} />)).toContain(`data-material-symbol="${icon}"`)
    }
  })
})
