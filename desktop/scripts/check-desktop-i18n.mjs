// Checks the desktop locales (src/i18n/locales/<lang>/<section>.json):
// - every language has the files and keys of Turkish (the source), no more;
// - every text is a non-empty string with the same {{placeholders}} as Turkish
//   (the rule of frontend/scripts/check-i18n.mjs);
// - errors.json has exactly one key per error code the window can show: the
//   server codes (contracts/sync/error-codes.schema.json), the shell codes
//   (src/bridge/generated/ShellErrorCode.ts) and the adapter codes
//   (ADAPTER_ERROR_CODES in src/wire/errorCodes.ts);
// - onlineOnly.json has exactly one key per online_only[] action of
//   contracts/offline-manifest.json, whose i18n_key is desktop.onlineOnly.<action>.
// Options (tests point them at changed copies): --locales, --manifest,
// --error-schema, --shell-codes, --adapter-codes.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const contracts = join(desktop, '..', 'contracts')
const { values: options } = parseArgs({
  options: {
    locales: { type: 'string', default: join(desktop, 'src', 'i18n', 'locales') },
    manifest: { type: 'string', default: join(contracts, 'offline-manifest.json') },
    'error-schema': { type: 'string', default: join(contracts, 'sync', 'error-codes.schema.json') },
    'shell-codes': { type: 'string', default: join(desktop, 'src', 'bridge', 'generated', 'ShellErrorCode.ts') },
    'adapter-codes': { type: 'string', default: join(desktop, 'src', 'wire', 'errorCodes.ts') },
  },
})
const root = resolve(options.locales)
const SOURCE = 'tr'
const ONLINE_ONLY_PREFIX = 'desktop.onlineOnly.'
const problems = []

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

function leaves(value, prefix = '', out = new Map()) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    out.set(prefix, value)
    return out
  }
  for (const [key, child] of Object.entries(value)) leaves(child, prefix === '' ? key : `${prefix}.${key}`, out)
  return out
}

const placeholders = (text) =>
  [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',')

function stringLiterals(file, pattern) {
  const block = pattern.exec(readFileSync(file, 'utf8'))?.[1]
  if (block === undefined) {
    problems.push(`${file}: code list not found`)
    return []
  }
  return [...block.matchAll(/["']([A-Z][A-Z0-9_]*)["']/g)].map((m) => m[1])
}

function expectedErrorCodes() {
  const server = readJson(options['error-schema']).oneOf.map((entry) => entry.const)
  const shell = stringLiterals(options['shell-codes'], /export type ShellErrorCode\s*=([^;]*);/)
  const adapter = stringLiterals(options['adapter-codes'], /export const ADAPTER_ERROR_CODES\s*=\s*\[([^\]]*)\]/)
  return new Set([...server, ...shell, ...adapter])
}

function expectedOnlineOnlyKeys() {
  const keys = new Set()
  for (const { action, i18n_key: key } of readJson(options.manifest).online_only) {
    if (key !== `${ONLINE_ONLY_PREFIX}${action}`) {
      problems.push(`manifest online_only ${action}: i18n_key ${key} is not ${ONLINE_ONLY_PREFIX}${action}`)
    }
    keys.add(String(key).slice(ONLINE_ONLY_PREFIX.length))
  }
  return keys
}

// File name to the key set it must have, for the files tied to a contract.
const CONTRACT_KEYS = {
  'errors.json': { name: 'error code', keys: expectedErrorCodes() },
  'onlineOnly.json': { name: 'online_only action', keys: expectedOnlineOnlyKeys() },
}

const languages = readdirSync(root).sort()
const jsonIn = (lang) => readdirSync(join(root, lang)).filter((f) => f.endsWith('.json')).sort()
const files = jsonIn(SOURCE)

for (const lang of languages) {
  const present = jsonIn(lang)
  for (const file of files.filter((f) => !present.includes(f))) problems.push(`${lang}/${file}: missing file`)
  for (const file of present.filter((f) => !files.includes(f))) problems.push(`${lang}/${file}: not in ${SOURCE}`)
}

for (const file of files) {
  const source = leaves(readJson(join(root, SOURCE, file)))
  const contract = CONTRACT_KEYS[file]
  if (contract !== undefined) {
    for (const key of contract.keys) if (!source.has(key)) problems.push(`${SOURCE}/${file}: missing ${contract.name} ${key}`)
    for (const key of source.keys()) if (!contract.keys.has(key)) problems.push(`${SOURCE}/${file}: ${key} is not an ${contract.name}`)
  }
  for (const lang of languages) {
    if (!jsonIn(lang).includes(file)) continue
    const target = lang === SOURCE ? source : leaves(readJson(join(root, lang, file)))
    for (const [key, text] of target) {
      if (typeof text !== 'string' || text.trim() === '') problems.push(`${lang}/${file}: ${key} is not a text`)
    }
    if (lang === SOURCE) continue
    for (const key of source.keys()) if (!target.has(key)) problems.push(`${lang}/${file}: missing ${key}`)
    for (const key of target.keys()) if (!source.has(key)) problems.push(`${lang}/${file}: extra ${key}`)
    for (const [key, text] of target) {
      if (source.has(key) && placeholders(text) !== placeholders(source.get(key))) {
        problems.push(`${lang}/${file}: placeholder mismatch ${key}`)
      }
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}
console.log(
  `Desktop locales match ${SOURCE}: ${languages.join(', ')} x ${files.length} files; ` +
    `${CONTRACT_KEYS['errors.json'].keys.size} error codes, ${CONTRACT_KEYS['onlineOnly.json'].keys.size} online-only actions.`,
)
