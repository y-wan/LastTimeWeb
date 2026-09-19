import { describe, expect, it } from 'vitest'
import { translations } from '../i18n'

describe('translation parity', () => {
  it('keeps English and Simplified Chinese keys complete and non-empty', () => {
    expect(Object.keys(translations['zh-CN']).sort()).toEqual(Object.keys(translations.en).sort())
    for (const locale of Object.values(translations)) {
      for (const value of Object.values(locale)) expect(value.trim()).not.toBe('')
    }
  })
})
