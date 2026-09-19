import type { ManifestOptions } from 'vite-plugin-pwa'

interface LocalizedManifestText {
  value: string
  dir?: 'ltr' | 'rtl' | 'auto'
}

type LocalizedManifest = Partial<ManifestOptions> & {
  name_localized: Record<string, string | LocalizedManifestText>
  short_name_localized: Record<string, string | LocalizedManifestText>
  description_localized: Record<string, string | LocalizedManifestText>
}

export const pwaAssets = [
  'app-icon.svg',
  'app-icon-maskable.svg',
  'apple-touch-icon-180.png',
  'app-icon-192.png',
  'app-icon-512.png',
  'app-icon-maskable-192.png',
  'app-icon-maskable-512.png'
]

export const pwaManifest: LocalizedManifest = {
  name: 'Last Time',
  short_name: 'Last Time',
  description: 'Remember when you last did the things that matter.',
  name_localized: {
    zh: { value: '上次' },
    'zh-CN': { value: '上次' }
  },
  short_name_localized: {
    zh: { value: '上次' },
    'zh-CN': { value: '上次' }
  },
  description_localized: {
    zh: { value: '记住某件事上次发生的时间。' },
    'zh-CN': { value: '记住某件事上次发生的时间。' }
  },
  theme_color: '#D65A3A',
  background_color: '#FAF7F3',
  display: 'standalone',
  orientation: 'portrait-primary',
  start_url: './',
  icons: [
    { src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'app-icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: 'app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}
