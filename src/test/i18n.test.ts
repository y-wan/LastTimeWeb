import { describe, expect, it } from 'vitest'
import { translations } from '../i18n'

describe('translation parity', () => {
  it('keeps English and Simplified Chinese keys complete and non-empty', () => {
    expect(Object.keys(translations['zh-CN']).sort()).toEqual(Object.keys(translations.en).sort())
    for (const locale of Object.values(translations)) {
      for (const value of Object.values(locale)) expect(value.trim()).not.toBe('')
    }
  })

  it('uses the official iOS product name without advertising an unreleased Android import source', () => {
    expect(translations.en.importHint).toBe('Import items and history exported by this app or Last Time Tracker for iOS.')
    expect(translations['zh-CN'].importHint).toBe('从本应用导出的 CSV 或 iOS 版「上次」导入事项和历史记录。')
    expect(translations.en.importHint).not.toContain('Android')
    expect(translations['zh-CN'].importHint).not.toContain('Android')
  })
})
