import { describe, expect, it } from 'vitest'

// Import rules of the webview sources that the bundle swap relies on.
const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

// One import statement per match: its text and the module specifier.
const IMPORT = /^\s*(import|export)\b[^'"]*?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/gm

type Rule = (file: string, specifier: string, statement: string) => string | null

const RULES: Rule[] = [
  // The web transport stays out of the desktop bundle.
  (file, specifier) =>
    /^@\/platform\/(web|runtime)(\/|$)/.test(specifier) || /frontend\/src\/platform\/(web|runtime)/.test(specifier)
      ? `${file} imports the web runtime ${specifier}`
      : null,
  // Only the swapped runtime binds the real Tauri API; everything else takes
  // invoke and listen as parameters (tests use the fake bridge).
  (file, specifier) =>
    specifier.startsWith('@tauri-apps/') && file !== './platform/runtime.ts'
      ? `${file} imports ${specifier}`
      : null,
  // The web extensions module may be named for its type only: at run time
  // the bundle has the desktop one in its place.
  (file, specifier, statement) =>
    specifier === '@/app/extensions' && !/^\s*import type\b/.test(statement)
      ? `${file} imports the web extensions module at run time`
      : null,
]

function violations(files: Record<string, string>): string[] {
  const found: string[] = []
  for (const [file, text] of Object.entries(files)) {
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[2] ?? match[3] ?? ''
      for (const rule of RULES) {
        const problem = rule(file, specifier, match[0])
        if (problem !== null) found.push(problem)
      }
    }
  }
  return found
}

describe('webview import boundary', () => {
  it('holds for the desktop sources', () => {
    expect(Object.keys(sources)).toContain('./main.tsx')
    expect(Object.keys(sources)).toContain('./app/extensions.tsx')
    expect(violations(sources)).toEqual([])
  })

  it('flags each kind of break', () => {
    const files = {
      './ui/sync/A.tsx': "import { createWebHttp } from '@/platform/web/http'",
      './ui/sync/B.tsx': "import { createPlatform } from '@/platform/runtime'",
      './ui/sync/C.tsx': "const m = import('../../../frontend/src/platform/web/realtime')",
      './ui/account/D.tsx': "import { invoke } from '@tauri-apps/api/core'",
      './app/E.tsx': "import { appExtensions } from '@/app/extensions'",
      './app/F.tsx': "export { appExtensions } from '@/app/extensions'",
      './app/G.tsx': "import type { AppExtensions } from '@/app/extensions'",
      './platform/runtime.ts': "import { listen } from '@tauri-apps/api/event'",
    }
    expect(violations(files)).toEqual([
      './ui/sync/A.tsx imports the web runtime @/platform/web/http',
      './ui/sync/B.tsx imports the web runtime @/platform/runtime',
      './ui/sync/C.tsx imports the web runtime ../../../frontend/src/platform/web/realtime',
      './ui/account/D.tsx imports @tauri-apps/api/core',
      './app/E.tsx imports the web extensions module at run time',
      './app/F.tsx imports the web extensions module at run time',
    ])
  })
})
