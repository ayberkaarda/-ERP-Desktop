import { posix } from 'node:path'

import { describe, expect, it } from 'vitest'

// Package roots under src/. Each one is reached from outside only through
// its index.ts; the composition root imports nothing else from them.
const PACKAGES = ['platform', 'sync', 'ui/sync', 'ui/account', 'wire'] as const

const surfaces = import.meta.glob([
  './platform/index.ts',
  './sync/index.ts',
  './ui/sync/index.ts',
  './ui/account/index.ts',
  './wire/index.ts',
])

const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./bridge/generated/**', '!./packages.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const SPECIFIER = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

// Normalised src-relative path ("platform/http") or null for bare modules.
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith('@desktop/')) return specifier.slice('@desktop/'.length)
  if (specifier.startsWith('.')) {
    return posix.normalize(posix.join(posix.dirname(file), specifier)).replace(/^\.\//, '')
  }
  return null
}

// Most specific package that owns a src-relative path ("ui/sync" before "ui").
function owner(path: string): string | undefined {
  return [...PACKAGES]
    .sort((a, b) => b.length - a.length)
    .find((pkg) => path === pkg || path.startsWith(`${pkg}/`))
}

function deepImports(files: Record<string, string>): string[] {
  const found: string[] = []
  for (const [file, text] of Object.entries(files)) {
    const from = owner(file.replace(/^\.\//, ''))
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? ''
      const target = resolveSpecifier(file, specifier)
      if (target === null) continue
      const pkg = owner(target)
      if (pkg === undefined || pkg === from) continue
      const surface = target === pkg || target === `${pkg}/index` || target === `${pkg}/index.ts`
      if (!surface) found.push(`${file} -> ${specifier}`)
    }
  }
  return found
}

describe('package skeleton', () => {
  it('has an index.ts surface for every package', () => {
    expect(Object.keys(surfaces).sort()).toEqual(
      PACKAGES.map((pkg) => `./${pkg}/index.ts`).sort(),
    )
  })

  it('loads every surface without a Tauri runtime', async () => {
    for (const load of Object.values(surfaces)) {
      await expect(load()).resolves.toBeTypeOf('object')
    }
  })

  it('reaches other packages only through their index', () => {
    expect(deepImports(sources)).toEqual([])
  })

  it('flags an import of another package internals', () => {
    const files = {
      './app/extensions.tsx': "import { x } from '@desktop/ui/sync/Badge'\nimport '../sync'",
      './ui/account/Login.tsx': "import { y } from '../../platform/http'\nimport { z } from './Form'",
      './ui/sync/Badge.tsx': "import { s } from '../../sync/index.ts'\nimport('../../wire/fixtures')",
    }
    expect(deepImports(files)).toEqual([
      "./app/extensions.tsx -> @desktop/ui/sync/Badge",
      './ui/account/Login.tsx -> ../../platform/http',
      './ui/sync/Badge.tsx -> ../../wire/fixtures',
    ])
  })
})
