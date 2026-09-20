import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaAssets } from './pwaManifest'

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string
const buildSha = process.env.GITHUB_SHA ??
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.CF_COMMIT_SHA ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'last-time-build-metadata',
      transformIndexHtml(html) {
        return html.replace(
          '</head>',
          `    <meta name="last-time-version" content="${packageVersion}" />\n    <meta name="last-time-build" content="${buildSha}" />\n  </head>`
        )
      }
    },
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: pwaAssets,
      manifest: false,
      workbox: {
        navigateFallback: null,
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [{
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'last-time-pages',
            precacheFallback: {
              fallbackURL: 'index.html'
            }
          }
        }]
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**']
  }
})
