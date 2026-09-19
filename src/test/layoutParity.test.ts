import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src', 'styles.css'), 'utf8')

describe('Android layout parity guards', () => {
  it('keeps the record touch target separate from its 36px visual circle', () => {
    expect(css).toMatch(/\.record-button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*border:\s*0[^}]*background:\s*transparent/s)
    expect(css).toMatch(/\.record-button\s*>\s*span\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*45%[^}]*7%/s)
  })

  it('constrains Settings controls instead of expanding the document', () => {
    expect(css).toMatch(/\.settings-card\s*\{[^}]*max-width:\s*100%[^}]*min-width:\s*0/s)
    expect(css).toMatch(/\.segmented\s*\{[^}]*grid-auto-columns:\s*minmax\(0,\s*1fr\)/s)
    expect(css).toMatch(/\.palette-list\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s)
  })

  it('keeps selected and unselected palette cards on identical box metrics', () => {
    expect(css).toMatch(/\.palette-card\s*\{[^}]*grid-template-rows:\s*62px 22px[^}]*padding:\s*8px[^}]*border:\s*2px solid transparent[^}]*box-shadow:\s*inset 0 0 0 1px var\(--outline\)/s)
    expect(css).toMatch(/\.palette-card\.selected\s*\{[^}]*border-color:\s*var\(--primary\)[^}]*box-shadow:\s*none/s)
    expect(css).toMatch(/\.palette-title\s*\{[^}]*height:\s*22px[^}]*padding-right:\s*24px[^}]*line-height:\s*22px/s)
    expect(css).toMatch(/\.palette-check\s*\{[^}]*position:\s*absolute[^}]*right:\s*8px[^}]*bottom:\s*8px/s)
    expect(css).not.toMatch(/\.palette-card\s*>\s*svg/)
  })

  it('uses opaque full-viewport detail and editor screens', () => {
    expect(css).toMatch(/\.screen-overlay\s*\{[^}]*inset:\s*0[^}]*background:\s*var\(--bg\)/s)
    expect(css).toMatch(/\.screen-sheet\s*\{[^}]*height:\s*100dvh/s)
    expect(css).not.toMatch(/backdrop-filter/)
    expect(css).toMatch(/\.editor-header,\s*\.detail-header\s*\{[^}]*background:\s*var\(--surface\)[^}]*border-bottom:/s)
  })
})
