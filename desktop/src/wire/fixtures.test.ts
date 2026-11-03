// @vitest-environment node
// The TypeScript suite of the contract fixtures (B8): the same files as the
// PHP suite and contracts/scripts/validate.mjs (Ajv) and the Rust suite
// (crates/keystone-sync/tests/wire_fixtures.rs), with the same file -> schema rule.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

import { FIXTURE_SCHEMAS, INVALID_FIXTURES, VALID_FIXTURES } from './generated/fixtures'
import { wireFixtures, validFixture, wireFixture } from './fixtures'

const contracts = fileURLToPath(new URL('../../../contracts/', import.meta.url))
const syncDir = `${contracts}sync/`
const fixturesDir = `${syncDir}fixtures/`

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const jsonFiles = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()

/** Every fixture on disk, as "name" or "invalid/name". */
function fixturesOnDisk(): string[] {
  return [...jsonFiles(fixturesDir), ...jsonFiles(`${fixturesDir}invalid/`).map((n) => `invalid/${n}`)]
}

const schemaFiles = jsonFiles(syncDir).filter((name) => name.endsWith('.schema.json'))

/** `schema_for` of wire_fixtures.rs; offline-manifest.* go to the manifest schema. */
function schemaFor(fixture: string): string {
  const [prefix, kind] = fixture.replace(/^invalid\//, '').split('.')
  if (prefix === 'offline-manifest') return '../offline-manifest.schema.json'
  const found = [`${prefix}.schema.json`, `${prefix}.${kind}.schema.json`].find((n) => schemaFiles.includes(n))
  if (found === undefined) throw new Error(`no schema for ${fixture}`)
  return found
}

// Same options as contracts/scripts/validate.mjs.
function validators() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true })
  addFormats(ajv)
  const ids = new Map<string, string>()
  for (const file of [...schemaFiles, '../offline-manifest.schema.json']) {
    const schema = readJson(`${syncDir}${file}`) as { $id: string }
    ajv.addSchema(schema)
    ids.set(file, schema.$id)
  }
  return (schema: string, data: unknown) => {
    const id = ids.get(schema)
    const validate = id === undefined ? undefined : ajv.getSchema(id)
    if (validate === undefined) throw new Error(`schema ${schema} did not compile`)
    const valid = validate(data)
    return { valid, errors: ajv.errorsText(validate.errors) }
  }
}

const check = validators()

describe('contract fixtures against their schemas (Ajv 2020-12)', () => {
  it.each(fixturesOnDisk())('%s', (name) => {
    const { valid, errors } = check(schemaFor(name), readJson(`${fixturesDir}${name}`))
    const expected = !name.startsWith('invalid/')
    expect({ name, valid, errors: valid === expected ? '' : errors }).toEqual({ name, valid: expected, errors: '' })
  })

  it('accepts contracts/offline-manifest.json', () => {
    expect(check('../offline-manifest.schema.json', readJson(`${contracts}offline-manifest.json`)).valid).toBe(true)
  })

  it('compiles every sync schema in strict mode', () => {
    for (const schema of schemaFiles) expect(() => check(schema, null)).not.toThrow()
  })

  it('maps the fixtures to the schemas the Node validator uses', () => {
    const script = readFileSync(`${contracts}scripts/validate.mjs`, 'utf8')
    const text = script.slice(script.indexOf('const fixtureCases = ['), script.indexOf('];'))
    const table = [...text.matchAll(/\['([^']+\.json)', '([^']+\.schema\.json)', (true|false)\]/g)].map(
      ([, file, schema]) => [file, schema?.replace(/^sync\//, '').replace(/^offline-manifest/, '../offline-manifest')],
    )
    expect(table.length).toBeGreaterThan(0)
    expect(table).toEqual(fixturesOnDisk().map((name) => [name, schemaFor(name)]))
  })
})

describe('the generated fixture set (src/wire/generated/fixtures.ts)', () => {
  it('has every fixture file and no other', () => {
    expect(Object.keys(FIXTURE_SCHEMAS).sort()).toEqual(fixturesOnDisk().sort())
    expect([...Object.keys(VALID_FIXTURES), ...Object.keys(INVALID_FIXTURES)].sort()).toEqual(
      fixturesOnDisk().sort(),
    )
  })

  it.each(fixturesOnDisk())('%s is a copy of the file with its schema', (name) => {
    expect(wireFixture(name)).toEqual({
      name,
      schema: schemaFor(name),
      valid: !name.startsWith('invalid/'),
      data: readJson(`${fixturesDir}${name}`),
    })
  })

  it('hands out copies', () => {
    const first = validFixture('push.response.mixed.json')
    first.data.results.length = 0
    expect(validFixture('push.response.mixed.json').data.results.length).toBeGreaterThan(0)
    expect(wireFixtures().length).toBe(fixturesOnDisk().length)
  })

  it('refuses an unknown fixture', () => {
    expect(() => wireFixture('push.response.unknown.json')).toThrow(/no fixture/)
  })
})

describe('type binding of the valid fixtures', () => {
  // Root type of each schema module, as the Rust wire types are named.
  const ROOT_TYPES: Record<string, string> = {
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
  const text = readFileSync(fileURLToPath(new URL('./generated/fixtures.ts', import.meta.url)), 'utf8').replace(
    /\r\n/g,
    '\n',
  )
  const block = text.slice(text.indexOf('export const VALID_FIXTURES = {'), text.indexOf('\n}\n'))
  // One entry per valid fixture: from "  'name': " to the next entry.
  const entries = [...block.matchAll(/^ {2}'([^']+)': ([\s\S]*?)(?=^ {2}'|$(?![\s\S]))/gm)].map(
    ([, name, body]) => [name ?? '', (body ?? '').trimEnd()] as const,
  )

  it('has one entry per valid fixture', () => {
    expect(entries.map(([name]) => name)).toEqual(Object.keys(VALID_FIXTURES))
    expect(entries.length).toBe(jsonFiles(fixturesDir).length)
  })

  const typed = jsonFiles(fixturesDir).filter((name) => !name.startsWith('offline-manifest.'))

  it.each(typed)('%s ends in `satisfies` with its schema type and is never cast', (name) => {
    const body = entries.find(([entry]) => entry === name)?.[1] ?? ''
    expect(body.endsWith(` satisfies ${ROOT_TYPES[schemaFor(name)] ?? '?'},`)).toBe(true)
    expect(body).not.toMatch(/\bas\s+(unknown|any|const|[A-Z]\w*)\b/)
    expect(text).toContain(`import type { ${ROOT_TYPES[schemaFor(name)] ?? '?'} } from`)
  })

  // The offline manifest schema has no generated type: its fixtures are
  // plain data, never cast (the Rust tests check them against the schema).
  it.each(jsonFiles(fixturesDir).filter((name) => name.startsWith('offline-manifest.')))(
    '%s is plain data',
    (name) => {
      const body = entries.find(([entry]) => entry === name)?.[1] ?? ''
      expect(body.endsWith('},')).toBe(true)
      expect(body).not.toMatch(/\bsatisfies\b|\bas\s+(unknown|any|const|[A-Z]\w*)\b/)
    },
  )
})
