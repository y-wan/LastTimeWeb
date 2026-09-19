import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
const iconLink = '<link rel="apple-touch-icon" sizes="180x180" href="https://lasttimeweb.feliciameow.workers.dev/apple-touch-icon.png" />'
const iconIndex = html.indexOf(iconLink)
const localeBootstrapIndex = html.indexOf("const localeKey = 'last-time-app-locale'")

if (iconIndex < 0) throw new Error('Built HTML is missing the absolute Apple touch icon link')
if (localeBootstrapIndex < 0 || iconIndex > localeBootstrapIndex) {
  throw new Error('Apple touch icon link must appear before the locale/runtime bootstrap')
}

const png = readFileSync(join(root, 'dist', 'apple-touch-icon.png'))
const signature = '89504e470d0a1a0a'
if (png.subarray(0, 8).toString('hex') !== signature) {
  throw new Error('Built Apple touch icon is not a PNG')
}

const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)
if (width !== 180 || height !== 180) {
  throw new Error(`Built Apple touch icon must be 180x180, received ${width}x${height}`)
}

console.log('Verified built Apple touch icon link and 180x180 PNG asset.')
