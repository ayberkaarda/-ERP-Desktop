// Fails when any locale's key set or placeholders differ from tr.json (the source locale).
// Checks the default namespace (locales/<lang>.json) and every namespace folder
// (locales/<ns>/<lang>.json); each namespace must exist in every locale.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

const load = (folder, lang) => JSON.parse(readFileSync(join(folder, `${lang}.json`), 'utf8'))
const jsonLangs = (folder) =>
  readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))

const locales = jsonLangs(dir)
const namespaces = [
  { name: 'translation', folder: dir },
  ...readdirSync(dir)
    .filter((f) => statSync(join(dir, f)).isDirectory())
    .sort()
    .map((name) => ({ name, folder: join(dir, name) })),
]

let failed = false
const summary = []
for (const ns of namespaces) {
  const prefix = ns.name === 'translation' ? '' : `${ns.name}/`
  if (!existsSync(join(ns.folder, `${SOURCE}.json`))) {
    console.error(`${prefix}${SOURCE}: missing source file`)
    failed = true
    continue
  }
  const source = load(ns.folder, SOURCE)
  const sourceKeys = new Set(flatten(source))
  const sourceVars = placeholders(source)
  const present = jsonLangs(ns.folder)
  for (const lang of locales.filter((l) => l !== SOURCE)) {
    if (!present.includes(lang)) {
      console.error(`${prefix}${lang}: missing file`)
      failed = true
      continue
    }
    const data = load(ns.folder, lang)
    const keys = new Set(flatten(data))
    const missing = [...sourceKeys].filter((k) => !keys.has(k))
    const extra = [...keys].filter((k) => !sourceKeys.has(k))
    const vars = placeholders(data)
    const mismatched = [...sourceKeys].filter(
      (k) => keys.has(k) && vars.get(k) !== sourceVars.get(k),
    )
    for (const k of missing) console.error(`${prefix}${lang}: missing ${k}`)
    for (const k of extra) console.error(`${prefix}${lang}: extra ${k}`)
    for (const k of mismatched) console.error(`${prefix}${lang}: placeholder mismatch ${k}`)
    if (missing.length || extra.length || mismatched.length) failed = true
  }
  for (const lang of present.filter((l) => !locales.includes(l))) {
    console.error(`${prefix}${lang}: locale has no default namespace file`)
    failed = true
  }
  summary.push(`${ns.name} ${sourceKeys.size}`)
}

if (failed) process.exit(1)
console.log(`i18n parity ok: ${summary.join(', ')} keys × ${locales.length} locales`)
