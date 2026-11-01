// Checks that every desktop locale has the same files and keys as Turkish,
// the source language. Placeholder checks are still to be added.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales')
const SOURCE = 'tr'

function keyPaths(value, prefix = '') {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

function load(lang, file) {
  return new Set(keyPaths(JSON.parse(readFileSync(join(root, lang, file), 'utf8'))))
}

const languages = readdirSync(root).sort()
const files = readdirSync(join(root, SOURCE)).filter((f) => f.endsWith('.json')).sort()
const problems = []

for (const lang of languages) {
  const present = readdirSync(join(root, lang)).filter((f) => f.endsWith('.json')).sort()
  for (const file of files.filter((f) => !present.includes(f))) problems.push(`${lang}/${file}: missing file`)
  for (const file of present.filter((f) => !files.includes(f))) problems.push(`${lang}/${file}: not in ${SOURCE}`)
  if (lang === SOURCE) continue
  for (const file of files.filter((f) => present.includes(f))) {
    const source = load(SOURCE, file)
    const target = load(lang, file)
    for (const key of source) if (!target.has(key)) problems.push(`${lang}/${file}: missing ${key}`)
    for (const key of target) if (!source.has(key)) problems.push(`${lang}/${file}: extra ${key}`)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}
console.log(`Desktop locales match ${SOURCE}: ${languages.join(', ')} x ${files.length} files.`)
