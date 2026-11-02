// Writes src/wire/generated from contracts/:
// - one module per contracts/sync/*.schema.json (json-schema-to-typescript),
// - fixtures.ts: every contracts/sync/fixtures file as data, the valid ones
//   bound to their schema type with `satisfies` (type-checked by tsc),
// - onlineOnly.ts: online_only[] of contracts/offline-manifest.json.
// Usage: node scripts/gen-wire-ts.mjs [outDir]. check-wire-ts.sh diffs the result.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compile } from 'json-schema-to-typescript'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const contracts = join(desktop, '..', 'contracts')
const syncDir = join(contracts, 'sync')
const fixturesDir = join(syncDir, 'fixtures')
const out = resolve(process.argv[2] ?? join(desktop, 'src', 'wire', 'generated'))
const BANNER = [
  '// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.',
  '// After a contract change run `npm run -w desktop wire:gen` and commit.',
].join('\n')

// Schema file to the name of its root type (same names as the Rust wire types).
// A schema missing here stops the run, like `round_trip_for` in wire_fixtures.rs.
const ROOT_TYPES = {
  'common.schema.json': 'CommonSamples',
  'device-login.request.schema.json': 'DeviceLoginRequest',
  'device-refresh.request.schema.json': 'DeviceRefreshRequest',
  'device-token.response.schema.json': 'DeviceTokenResponse',
  'error-codes.schema.json': 'ErrorCode',
  'error.response.schema.json': 'ErrorResponse',
  'manifest.response.schema.json': 'ManifestResponse',
  'pull.request.schema.json': 'PullRequest',
  'pull.response.schema.json': 'PullResponse',
  'push.request.schema.json': 'PushRequest',
  'push.response.schema.json': 'PushResponse',
  'tombstone.schema.json': 'Tombstone',
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const moduleName = (schemaFile) => schemaFile.replace(/\.schema\.json$/, '')

function rootType(schemaFile) {
  const name = ROOT_TYPES[schemaFile]
  if (name === undefined) throw new Error(`no root type name for contracts/sync/${schemaFile}`)
  return name
}

// The title names the generated type; the Turkish titles become descriptions.
function renamed(schemaFile) {
  const schema = readJson(join(syncDir, schemaFile))
  const { title, ...rest } = schema
  return {
    ...rest,
    title: rootType(schemaFile),
    description: [title, rest.description].filter(Boolean).join('. '),
  }
}

// Every $ref names a sibling schema file (by its $id URI or by its path):
// read it from contracts/sync, renamed like the root, never over the network.
const SCHEMA_FILE = /([a-z.-]+\.schema\.json)$/
const localSchemas = {
  order: 1,
  canRead: (file) => SCHEMA_FILE.test(file.url.split('#')[0]),
  read: (file) => JSON.stringify(renamed(SCHEMA_FILE.exec(file.url.split('#')[0])[1])),
}

// A string schema with a oneOf of consts comes out as "(...) & string"; the
// union alone is the same type.
const withoutStringIntersection = (text) => text.replace(/\)\s*&\s*string\b/g, ')')

async function schemaModule(schemaFile) {
  return withoutStringIntersection(await compile(renamed(schemaFile), rootType(schemaFile), {
    bannerComment: BANNER,
    cwd: syncDir,
    declareExternallyReferenced: true,
    unreachableDefinitions: false,
    format: true,
    style: { singleQuote: true, semi: false, printWidth: 100 },
    $refOptions: { resolve: { http: false, keystone: localSchemas } },
  }))
}

// Same rule as `schema_for` in crates/keystone-sync/tests/wire_fixtures.rs:
// "<prefix>.schema.json", else "<prefix>.<kind>.schema.json"; offline-manifest.*
// fixtures belong to contracts/offline-manifest.schema.json.
function schemaFor(fixture) {
  const [prefix, kind] = fixture.split('.')
  if (prefix === 'offline-manifest') return '../offline-manifest.schema.json'
  const found = [`${prefix}.schema.json`, `${prefix}.${kind}.schema.json`].find((name) => {
    try {
      return statSync(join(syncDir, name)).isFile()
    } catch {
      return false
    }
  })
  if (found === undefined) throw new Error(`no schema for fixture ${fixture}`)
  return found
}

const jsonFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()

function fixturesModule() {
  const valid = jsonFiles(fixturesDir)
  const invalid = jsonFiles(join(fixturesDir, 'invalid'))
  const imports = new Map()
  const lines = []
  for (const name of valid) {
    const schema = schemaFor(name)
    if (!(schema in ROOT_TYPES)) throw new Error(`fixture ${name} has no generated type (${schema})`)
    const type = rootType(schema)
    imports.set(type, `./${moduleName(schema)}`)
    const data = JSON.stringify(readJson(join(fixturesDir, name)), null, 2).replace(/\n/g, '\n  ')
    lines.push(`  '${name}': ${data} satisfies ${type},`)
  }
  const invalidLines = invalid.map((name) => {
    const data = JSON.stringify(readJson(join(fixturesDir, 'invalid', name)), null, 2).replace(/\n/g, '\n  ')
    return `  'invalid/${name}': ${data},`
  })
  const schemaLines = [...valid, ...invalid.map((name) => `invalid/${name}`)].map(
    (name) => `  '${name}': '${schemaFor(name.replace(/^invalid\//, ''))}',`,
  )
  return [
    BANNER,
    '',
    ...[...imports].sort(([a], [b]) => a.localeCompare(b)).map(([type, from]) => `import type { ${type} } from '${from}'`),
    '',
    '/** contracts/sync/fixtures/*.json, each checked against its schema type. */',
    'export const VALID_FIXTURES = {',
    ...lines,
    '}',
    '',
    '/** contracts/sync/fixtures/invalid/*.json: each one breaks its schema. */',
    'export const INVALID_FIXTURES: Readonly<Record<string, unknown>> = {',
    ...invalidLines,
    '}',
    '',
    '/** Fixture path (under contracts/sync/fixtures) to its schema (under contracts/sync). */',
    'export const FIXTURE_SCHEMAS: Readonly<Record<string, string>> = {',
    ...schemaLines,
    '}',
    '',
  ].join('\n')
}

function onlineOnlyModule() {
  const manifest = readJson(join(contracts, 'offline-manifest.json'))
  const rows = manifest.online_only.map(({ action, i18n_key, category, routes }) => ({
    action,
    i18n_key,
    category,
    routes,
  }))
  return [
    BANNER,
    '',
    '/** `online_only[]` of contracts/offline-manifest.json, in manifest order. */',
    `export const ONLINE_ONLY = ${JSON.stringify(rows, null, 2)} as const`,
    '',
    '/** `api_prefix` of contracts/offline-manifest.json. */',
    `export const API_PREFIX = ${JSON.stringify(manifest.api_prefix)}`,
    '',
  ].join('\n')
}

const schemaFiles = readdirSync(syncDir).filter((f) => f.endsWith('.schema.json')).sort()
const files = new Map()
for (const schemaFile of schemaFiles) files.set(`${moduleName(schemaFile)}.ts`, await schemaModule(schemaFile))
files.set('fixtures.ts', fixturesModule())
files.set('onlineOnly.ts', onlineOnlyModule())

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const [name, text] of files) writeFileSync(join(out, name), text.replace(/\r\n/g, '\n'))
console.log(`Wrote ${files.size} files to ${out}`)
