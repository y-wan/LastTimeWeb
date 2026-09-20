import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
const iconLink = '<link rel="apple-touch-icon" sizes="180x180" href="https://lasttimeweb.feliciameow.workers.dev/apple-touch-icon-20260919.png" />'
const iconIndex = html.indexOf(iconLink)
const localeBootstrapIndex = html.indexOf("const localeKey = 'last-time-app-locale'")
const moduleScriptIndex = html.indexOf('<script type="module"')
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const versionMeta = new RegExp(`<meta name="last-time-version" content="${packageVersion}"\\s*/?>`)
const buildMeta = /<meta name="last-time-build" content="[0-9a-f]{40}"\s*\/?>/

if (iconIndex < 0) throw new Error('Built HTML is missing the absolute Apple touch icon link')
if (localeBootstrapIndex < 0 || moduleScriptIndex < 0 || iconIndex > localeBootstrapIndex || iconIndex > moduleScriptIndex) {
  throw new Error('Apple touch icon link must appear before locale and module runtime code')
}
if (!versionMeta.test(html) || !buildMeta.test(html)) {
  throw new Error('Built HTML is missing release version or commit metadata')
}

const png = readFileSync(join(root, 'dist', 'apple-touch-icon-20260919.png'))
const signature = '89504e470d0a1a0a'
if (png.subarray(0, 8).toString('hex') !== signature) {
  throw new Error('Built Apple touch icon is not a PNG')
}

const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)
if (width !== 180 || height !== 180) {
  throw new Error(`Built Apple touch icon must be 180x180, received ${width}x${height}`)
}

const serviceWorker = readFileSync(join(root, 'dist', 'sw.js'), 'utf8')
if (!serviceWorker.includes('NetworkFirst') || !serviceWorker.includes('last-time-pages')) {
  throw new Error('Service worker must fetch navigations network-first before using the cached app shell')
}
if (serviceWorker.includes('new NavigationRoute(createHandlerBoundToURL("index.html")')) {
  throw new Error('Service worker must not route all navigations directly to precached index.html')
}

console.log('Verified build metadata, Apple touch icon, and network-first navigation handling.')
