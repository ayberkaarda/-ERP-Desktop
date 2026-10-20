// Fails when any locale's key set differs from tr.json (the source locale).
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'i18n', 'locales')
const SOURCE = 'tr'

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value !== null && typeof value === 'object' ? flatten(value, path) : [path]
  })
}

function placeholders(obj, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object') placeholders(value, path, out)
    else
      out.set(
        path,
        [...String(value).matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
          .map((m) => m[1])
          .sort()
          .join(','),
      )
  }
  return out
}

const load = (lang) => JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8'))
const source = load(SOURCE)
const sourceKeys = new Set(flatten(source))
const sourceVars = placeholders(source)
const langs = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .filter((l) => l !== SOURCE)

let failed = false
for (const lang of langs) {
  const data = load(lang)
  const keys = new Set(flatten(data))
  const missing = [...sourceKeys].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !sourceKeys.has(k))
  const vars = placeholders(data)
  const mismatched = [...sourceKeys].filter((k) => keys.has(k) && vars.get(k) !== sourceVars.get(k))
  for (const k of missing) console.error(`${lang}: missing ${k}`)
  for (const k of extra) console.error(`${lang}: extra ${k}`)
  for (const k of mismatched) console.error(`${lang}: placeholder mismatch ${k}`)
  if (missing.length || extra.length || mismatched.length) failed = true
}

if (failed) process.exit(1)
console.log(`i18n parity ok: ${sourceKeys.size} keys × ${langs.length + 1} locales`)
