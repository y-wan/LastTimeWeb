import { chromium } from '@playwright/test'

const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.replace(/^--/, '').split('=')
  return [key, value.join('=')]
}))
const baseUrl = (options.url ?? 'https://lasttimeweb.feliciameow.workers.dev').replace(/\/$/, '')
const expectedVersion = options.version
const expectedSha = options.sha
const attempts = Number(options.attempts ?? 30)
const delayMs = Number(options.delay ?? 10_000)
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function get(pathname) {
  const response = await fetch(`${baseUrl}${pathname}${pathname.includes('?') ? '&' : '?'}smoke=${Date.now()}`, {
    headers: { 'cache-control': 'no-cache' }
  })
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}`)
  return { response, body: await response.arrayBuffer() }
}

function text(buffer) {
  return new TextDecoder().decode(buffer)
}

let deployment
for (let attempt = 1; attempt <= attempts; attempt++) {
  const { body } = await get('/')
  const html = text(body)
  const version = html.match(/name="last-time-version" content="([^"]+)"/)?.[1]
  const sha = html.match(/name="last-time-build" content="([^"]+)"/)?.[1]
  console.log(`Deployment check ${attempt}/${attempts}: version=${version ?? 'missing'} sha=${sha ?? 'missing'}`)
  if ((!expectedVersion || version === expectedVersion) && (!expectedSha || sha === expectedSha)) {
    deployment = { html, version, sha }
    break
  }
  await sleep(delayMs)
}
if (!deployment) throw new Error('Production did not reach the expected version and commit within the retry window')

const jsAsset = deployment.html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0]
const cssAsset = deployment.html.match(/assets\/index-[A-Za-z0-9_-]+\.css/)?.[0]
const touchIcon = deployment.html.match(/<link rel="apple-touch-icon"[^>]+href="([^"]+)"/)?.[1]
if (!jsAsset || !cssAsset || !touchIcon) throw new Error('Production HTML is missing built assets or the Apple touch icon')

const [{ body: serviceWorkerBody }, { response: iconResponse, body: iconBody }, englishManifest, chineseManifest] = await Promise.all([
  get('/sw.js'),
  get(new URL(touchIcon, baseUrl).pathname),
  get('/manifest.en.webmanifest'),
  get('/manifest.zh-CN.webmanifest')
])
const serviceWorker = text(serviceWorkerBody)
if (!serviceWorker.includes(jsAsset) || !serviceWorker.includes('NetworkFirst')) {
  throw new Error('Production service worker does not reference the current bundle with NetworkFirst navigation')
}
if (!iconResponse.headers.get('content-type')?.startsWith('image/png')) throw new Error('Apple touch icon is not served as image/png')
const icon = Buffer.from(iconBody)
if (icon.readUInt32BE(16) !== 180 || icon.readUInt32BE(20) !== 180) throw new Error('Apple touch icon is not 180x180')

const manifests = {
  en: JSON.parse(text(englishManifest.body)),
  'zh-CN': JSON.parse(text(chineseManifest.body))
}
for (const [locale, manifest] of Object.entries(manifests)) {
  if (manifest.lang !== locale || !manifest.name || !manifest.short_name || manifest.id !== './') {
    throw new Error(`Invalid ${locale} production manifest`)
  }
}

const browser = await chromium.launch()
try {
  for (const locale of ['en', 'zh-CN']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 852 } })
    await context.addInitScript(({ localeKey, localeValue }) => {
      localStorage.setItem(localeKey, localeValue)
    }, { localeKey: 'last-time-app-locale', localeValue: locale })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(`${baseUrl}/?smoke=${Date.now()}`, { waitUntil: 'networkidle' })
    if (await page.title() !== manifests[locale].name) throw new Error(`Unexpected ${locale} page title`)
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    if (!href?.includes(`manifest.${locale}.webmanifest`)) throw new Error(`Unexpected ${locale} manifest selection`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    if (overflow) throw new Error(`${locale} layout overflows at 320px`)
    if (errors.length) throw new Error(`${locale} startup emitted ${errors.length} console or page error(s)`)
    await context.close()
  }
} finally {
  await browser.close()
}

console.log(`Production smoke passed for ${deployment.version} at ${deployment.sha}.`)
