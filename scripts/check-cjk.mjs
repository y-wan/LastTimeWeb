import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'playwright-report', 'test-results'])
const allowedFiles = new Set([
  'README.md',
  'README.zh-CN.md',
  'docs/images/last-time-hero.zh-CN.svg',
  'index.html',
  'public/manifest.en.webmanifest',
  'public/manifest.zh-CN.webmanifest',
  'src/appMetadata.ts',
  'src/date.ts',
  'src/i18n.ts',
  'src/iconCatalogue.ts',
  'e2e/install-metadata.spec.ts',
  'e2e/notification-layout.spec.ts',
  'e2e/readme-screenshots.capture.ts',
  'e2e/sync-status-layout.spec.ts',
  'e2e/undo-layout.spec.ts',
  'src/test/appMetadata.test.ts',
  'src/test/appNavigation.test.tsx',
  'src/test/authUi.test.tsx',
  'src/test/confirmationDialog.test.tsx',
  'src/test/date.test.ts',
  'src/test/i18n.test.ts',
  'src/test/iconMapping.test.tsx',
  'src/test/pwaManifest.test.ts',
  'src/test/syncStatusRendering.test.tsx'
])
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const textExtensions = new Set([
  '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.svg', '.ts', '.tsx', '.txt', '.webmanifest', '.yml', '.yaml'
])

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(absolute))
    else if (textExtensions.has(path.extname(entry.name))) files.push(absolute)
  }
  return files
}

const violations = []
for (const absolute of await collectFiles(root)) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, '/')
  const lines = (await readFile(absolute, 'utf8')).split(/\r?\n/)
  lines.forEach((line, index) => {
    if (!cjk.test(line)) return
    if (!allowedFiles.has(relative)) {
      violations.push(`${relative}:${index + 1}: CJK text is outside an approved localization file.`)
      return
    }
    if ((relative.startsWith('src/test/') || relative.startsWith('e2e/')) &&
        (/^\s*(?:\/\/|\/\*|\*)/.test(line) ||
         /\b(?:describe|it|test)\s*\(\s*['"`][^'"`]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(line))) {
      violations.push(`${relative}:${index + 1}: Test descriptions and comments must remain English.`)
    }
  })
}

if (violations.length) {
  console.error('CJK localization boundary check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`CJK localization boundary check passed (${allowedFiles.size} explicitly allowed files).`)
