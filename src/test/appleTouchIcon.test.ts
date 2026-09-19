import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Apple touch icon', () => {
  it('is parser-visible at an absolute conventional URL before runtime metadata', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
    const iconLink = '<link rel="apple-touch-icon" sizes="180x180" href="https://lasttimeweb.feliciameow.workers.dev/apple-touch-icon.png" />'
    expect(html).toContain(iconLink)
    expect(html.indexOf(iconLink)).toBeLessThan(html.indexOf("const localeKey = 'last-time-app-locale'"))
  })

  it('uses a branded 180x180 PNG', () => {
    const png = readFileSync(join(process.cwd(), 'public', 'apple-touch-icon.png'))
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(180)
    expect(png.readUInt32BE(20)).toBe(180)
  })
})
