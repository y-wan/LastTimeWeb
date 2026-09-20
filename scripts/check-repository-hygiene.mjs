import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8'
}).split(/\r?\n/).filter(Boolean)

const blockedPathPatterns = [
  { pattern: /(^|\/)(?:dist|temp|tmp|test-results|playwright-report|\.lighthouseci)(\/|$)/i, reason: 'generated output' },
  { pattern: /\.(?:csv|log)$/i, reason: 'data or log artifact' },
  { pattern: /(^|\/)\.env(?:\.|$)/i, reason: 'environment file', allow: /^\.env\.example$/ },
  { pattern: /(?:private|personal|sensitive)[^/]*\.(?:png|jpe?g|webp)$/i, reason: 'private screenshot' }
]
const textExtensions = new Set([
  '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.ts', '.tsx', '.txt', '.webmanifest', '.yml', '.yaml'
])
const contentChecks = [
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, reason: 'private key material' },
  { pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/, reason: 'GitHub token' },
  { pattern: /\bAccountKey=[A-Za-z0-9+/=]{20,}/, reason: 'cloud storage account key' },
  { pattern: /(?:^|[^A-Za-z])(?:C:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+)/, reason: 'absolute user path' }
]
const emailPattern = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi
const allowedEmailDomains = new Set(['example.com', 'users.noreply.github.com', 'izs.me'])
const violations = []

for (const relative of files) {
  const normalized = relative.replaceAll('\\', '/')
  for (const rule of blockedPathPatterns) {
    if (rule.pattern.test(normalized) && !rule.allow?.test(normalized)) {
      violations.push(`${normalized}: blocked ${rule.reason}`)
    }
  }
  if (!textExtensions.has(path.extname(normalized))) continue
  const lines = (await readFile(path.join(root, relative), 'utf8')).split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const check of contentChecks) {
      if (check.pattern.test(line)) violations.push(`${normalized}:${index + 1}: possible ${check.reason}`)
    }
    for (const match of line.matchAll(emailPattern)) {
      if (!allowedEmailDomains.has(match[1].toLowerCase())) {
        violations.push(`${normalized}:${index + 1}: non-example email fixture`)
      }
    }
  })
}

if (violations.length) {
  console.error('Repository privacy and hygiene check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`Repository privacy and hygiene check passed (${files.length} files inspected).`)
