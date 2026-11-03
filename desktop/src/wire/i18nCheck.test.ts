// @vitest-environment node
// scripts/check-desktop-i18n.mjs (npm run i18n:check) on the real locales and
// on copies with one change each: the gate must name the problem and fail.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const desktop = fileURLToPath(new URL('../../', import.meta.url))
const script = join(desktop, 'scripts', 'check-desktop-i18n.mjs')
const locales = join(desktop, 'src', 'i18n', 'locales')
const manifestFile = fileURLToPath(new URL('../../../contracts/offline-manifest.json', import.meta.url))
const shellCodes = join(desktop, 'src', 'bridge', 'generated', 'ShellErrorCode.ts')
const adapterCodes = join(desktop, 'src', 'wire', 'errorCodes.ts')

type Json = Record<string, unknown>
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-i18n-'))
  dirs.push(dir)
  return dir
}

/** A copy of the locales with `change` applied; returns its path. */
function changedLocales(change: (read: (f: string) => Json, write: (f: string, v: unknown) => void) => void) {
  const dir = join(workDir(), 'locales')
  cpSync(locales, dir, { recursive: true })
  change(
    (file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Json,
    (file, value) => writeFileSync(join(dir, file), JSON.stringify(value, null, 2)),
  )
  return dir
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

function edit(dir: string, file: string, change: (data: Json) => void) {
  const path = join(dir, file)
  const data = JSON.parse(readFileSync(path, 'utf8')) as Json
  change(data)
  writeFileSync(path, JSON.stringify(data, null, 2))
}

describe('check-desktop-i18n', () => {
  it('passes on the committed locales', () => {
    const { status, out } = run()
    expect(out).toMatch(/59 error codes, 19 online-only actions/)
    expect(status).toBe(0)
  })

  it.each(['tr', 'en', 'de', 'fr'])('fails when %s/errors.json loses a code', (lang) => {
    const dir = changedLocales((read, write) => {
      const data = read(`${lang}/errors.json`)
      delete data.STORE_KEY_INVALID
      write(`${lang}/errors.json`, data)
    })
    const { status, out } = run('--locales', dir)
    expect(status).toBe(1)
    expect(out).toContain(lang === 'tr' ? 'tr/errors.json: missing error code STORE_KEY_INVALID' : `${lang}/errors.json: missing STORE_KEY_INVALID`)
  })

  it('fails on an error key that is no code (all languages)', () => {
    const dir = changedLocales((read, write) => {
      for (const lang of ['tr', 'en', 'de', 'fr']) write(`${lang}/errors.json`, { ...read(`${lang}/errors.json`), OLD_CODE: 'x' })
    })
    const { status, out } = run('--locales', dir)
    expect(status).toBe(1)
    expect(out).toContain('tr/errors.json: OLD_CODE is not an error code')
  })

  it('fails on an extra key in one language', () => {
    const dir = changedLocales((read, write) => write('de/onlineOnly.json', { ...read('de/onlineOnly.json'), extra: 'x' }))
    const { status, out } = run('--locales', dir)
    expect(status).toBe(1)
    expect(out).toContain('de/onlineOnly.json: extra extra')
  })

  it('fails when the manifest gains an online_only action without a text', () => {
    const dir = workDir()
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { online_only: Json[] }
    manifest.online_only.push({
      action: 'closeCashRegister',
      i18n_key: 'desktop.onlineOnly.closeCashRegister',
      category: 'payment',
      routes: ['POST /api/v1/cash-registers/{id}/close'],
    })
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
    const { status, out } = run('--manifest', join(dir, 'manifest.json'))
    expect(status).toBe(1)
    expect(out).toContain('tr/onlineOnly.json: missing online_only action closeCashRegister')
  })

  it('fails on an i18n_key outside desktop.onlineOnly.<action>', () => {
    const dir = workDir()
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { online_only: Json[] }
    const [first] = manifest.online_only
    if (first) first.i18n_key = 'desktop.onlineOnly.somethingElse'
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
    const { status, out } = run('--manifest', join(dir, 'manifest.json'))
    expect(status).toBe(1)
    expect(out).toContain('i18n_key desktop.onlineOnly.somethingElse is not desktop.onlineOnly.finalizeSalesQuote')
  })

  it('fails when the server, shell or adapter code lists gain a code', () => {
    const dir = workDir()
    const schema = JSON.parse(readFileSync(join(desktop, '..', 'contracts', 'sync', 'error-codes.schema.json'), 'utf8')) as {
      oneOf: Json[]
    }
    schema.oneOf.push({ const: 'SYNC_NEW_CODE' })
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(schema))
    writeFileSync(join(dir, 'shell.ts'), readFileSync(shellCodes, 'utf8').replace('"NO_ACTIVE_PROFILE"', '"NO_ACTIVE_PROFILE" | "SHELL_NEW_CODE"'))
    writeFileSync(join(dir, 'adapter.ts'), readFileSync(adapterCodes, 'utf8').replace("'REQUEST_STALE',", "'REQUEST_STALE', 'ADAPTER_NEW_CODE',"))
    const { status, out } = run('--error-schema', join(dir, 'schema.json'), '--shell-codes', join(dir, 'shell.ts'), '--adapter-codes', join(dir, 'adapter.ts'))
    expect(status).toBe(1)
    for (const code of ['SYNC_NEW_CODE', 'SHELL_NEW_CODE', 'ADAPTER_NEW_CODE']) {
      expect(out).toContain(`tr/errors.json: missing error code ${code}`)
    }
  })

  it('fails when the shell code list cannot be found', () => {
    const dir = workDir()
    writeFileSync(join(dir, 'shell.ts'), 'export type Other = "A"')
    const { status, out } = run('--shell-codes', join(dir, 'shell.ts'))
    expect(status).toBe(1)
    expect(out).toContain('code list not found')
  })

  it.each([
    ['fr', 'a placeholder only one language has', (text: string) => `${text} {{count}}`],
    ['en', 'a renamed placeholder', () => 'Try again in {{secs}} s.'],
  ])('fails on %s errors.json with %s', (lang, _what, change) => {
    const dir = changedLocales((read, write) => {
      if (lang === 'en') {
        // Give tr and the others {{seconds}}, en {{secs}}.
        for (const l of ['tr', 'de', 'fr']) write(`${l}/errors.json`, { ...read(`${l}/errors.json`), TOO_MANY_ATTEMPTS: '{{seconds}}' })
      }
      const data = read(`${lang}/errors.json`)
      data.TOO_MANY_ATTEMPTS = change(String(data.TOO_MANY_ATTEMPTS))
      write(`${lang}/errors.json`, data)
    })
    const { status, out } = run('--locales', dir)
    expect(status).toBe(1)
    expect(out).toContain(`${lang}/errors.json: placeholder mismatch TOO_MANY_ATTEMPTS`)
  })

  it('accepts the same placeholders in another order and spacing', () => {
    const dir = changedLocales((read, write) => {
      write('tr/sync.json', { ...read('tr/sync.json'), probe: '{{a}} ve {{b}}' })
      write('en/sync.json', { ...read('en/sync.json'), probe: '{{ b }} and {{a}}' })
      write('de/sync.json', { ...read('de/sync.json'), probe: '{{a}}{{b}}' })
      write('fr/sync.json', { ...read('fr/sync.json'), probe: '{{b}} {{a}}' })
    })
    expect(run('--locales', dir).status).toBe(0)
  })

  it.each([
    ['an empty text', ''],
    ['a number', 3],
    ['a list', ['a']],
  ])('fails on %s', (_what, value) => {
    const dir = changedLocales((read, write) => write('en/errors.json', { ...read('en/errors.json'), NOT_FOUND: value }))
    const { status, out } = run('--locales', dir)
    expect(status).toBe(1)
    expect(out).toContain('en/errors.json: NOT_FOUND is not a text')
  })

  it('fails on a missing or extra file', () => {
    const dir = changedLocales(() => undefined)
    rmSync(join(dir, 'de', 'errors.json'))
    writeFileSync(join(dir, 'fr', 'more.json'), '{}')
    edit(dir, 'en/onlineOnly.json', (data) => {
      data.liveReports = 'x'
    })
    const { status, out } = run('--locales', dir)
    expect(status).toBe(1)
    expect(out).toContain('de/errors.json: missing file')
    expect(out).toContain('fr/more.json: not in tr')
  })
})
