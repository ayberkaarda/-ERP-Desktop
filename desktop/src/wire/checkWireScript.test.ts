// @vitest-environment node
// scripts/check-wire-ts.sh itself, run in a throwaway git repository that holds
// a copy of contracts/, the two scripts and the committed output: a committed
// hand edit, a contract change without regenerating and a missing output file
// must each fail it.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const desktop = fileURLToPath(new URL('../../', import.meta.url))
const repo = join(desktop, '..')
const hasShell = spawnSync('sh', ['-c', 'git --version'], { encoding: 'utf8' }).status === 0
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function run(cwd: string, cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

function git(cwd: string, ...args: string[]) {
  const result = run(cwd, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'core.autocrlf=false', ...args])
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
}

/** A repository with the committed state of this branch for the wire gate. */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'wire-gate-'))
  dirs.push(root)
  cpSync(join(repo, 'contracts', 'sync'), join(root, 'contracts', 'sync'), { recursive: true })
  cpSync(join(repo, 'contracts', 'offline-manifest.json'), join(root, 'contracts', 'offline-manifest.json'))
  for (const script of ['gen-wire-ts.mjs', 'check-wire-ts.sh']) {
    cpSync(join(desktop, 'scripts', script), join(root, 'desktop', 'scripts', script))
  }
  cpSync(join(desktop, 'src', 'wire', 'generated'), join(root, 'desktop', 'src', 'wire', 'generated'), {
    recursive: true,
  })
  // json-schema-to-typescript from this checkout.
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'junction')
  writeFileSync(join(root, '.gitignore'), 'node_modules\n')
  git(root, 'init', '-q')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'base')
  return root
}

function gate(root: string) {
  return run(root, 'sh', [join(root, 'desktop', 'scripts', 'check-wire-ts.sh')])
}

function commitChange(root: string, file: string, change: (text: string) => string) {
  const path = join(root, file)
  writeFileSync(path, change(readFileSync(path, 'utf8')))
  git(root, 'commit', '-q', '-am', 'change')
}

describe.skipIf(!hasShell)('check-wire-ts.sh', () => {
  it('passes on the committed output', () => {
    const { status, out } = gate(sandbox())
    expect(out).toContain('Wire TypeScript matches contracts/.')
    expect(status).toBe(0)
  }, 120_000)

  it('fails on a committed hand edit of the output', () => {
    const root = sandbox()
    commitChange(root, 'desktop/src/wire/generated/onlineOnly.ts', (t) =>
      t.replace('/api/v1/sales-quotes/{id}/send', '/api/v1/sales-quotes/{id}/mail'),
    )
    const { status, out } = gate(root)
    expect(out).toContain('out of date')
    expect(status).not.toBe(0)
  }, 120_000)

  it('fails when a contract changes and the output is not regenerated', () => {
    const root = sandbox()
    // Only a description: no test or type check notices, only this gate.
    commitChange(root, 'contracts/sync/tombstone.schema.json', (t) =>
      t.replace('"description": "', '"description": "Changed. '),
    )
    const { status, out } = gate(root)
    expect(out).toContain('out of date')
    expect(out).toContain('tombstone.ts')
    expect(status).not.toBe(0)
  }, 120_000)

  it('fails when an output file is missing (written as an untracked file)', () => {
    const root = sandbox()
    unlinkSync(join(root, 'desktop', 'src', 'wire', 'generated', 'tombstone.ts'))
    git(root, 'commit', '-q', '-am', 'drop')
    const { status, out } = gate(root)
    expect(out).toContain('out of date')
    expect(out).toContain('src/wire/generated/tombstone.ts')
    expect(status).not.toBe(0)
  }, 120_000)
})

