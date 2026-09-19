import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['app-icon.svg'],
      manifest: {
        name: 'Last Time',
        short_name: 'Last Time',
        description: 'Remember when you last did the things that matter.',
        theme_color: '#e66d5b',
        background_color: '#fff8f3',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        icons: [
          { src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}']
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts']
  }
})
