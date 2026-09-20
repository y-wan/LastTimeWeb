import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const manifest = JSON.parse(await readFile('.lighthouseci/manifest.json', 'utf8'))
const categories = ['performance', 'accessibility', 'best-practices', 'seo']
const scores = Object.fromEntries(categories.map((category) => [category, []]))

for (const entry of manifest) {
  const report = JSON.parse(await readFile(path.resolve(entry.jsonPath), 'utf8'))
  for (const category of categories) scores[category].push(report.categories[category].score * 100)
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const labels = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  'best-practices': 'Best practices',
  seo: 'SEO'
}
const lines = [
  '## Lighthouse CI (mobile, report-only)',
  '',
  '| Category | Median score | Runs |',
  '|---|---:|---:|',
  ...categories.map((category) => `| ${labels[category]} | ${median(scores[category]).toFixed(0)} | ${scores[category].length} |`),
  '',
  'Scores are informational and do not block this workflow.'
]
const summary = `${lines.join('\n')}\n`
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
else console.log(summary)
