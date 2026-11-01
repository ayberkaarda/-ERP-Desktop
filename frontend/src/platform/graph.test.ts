// Static import graph of @/platform. The desktop build swaps runtime.ts for its own module,
// so nothing reachable from index.ts except through runtime.ts may pull the web transport.
const sources = import.meta.glob<string>(
  [
    '/src/platform/**/*.ts',
    '!/src/platform/**/*.test.ts',
    '/src/lib/i18n/index.ts',
    '/src/lib/storage.ts',
    '/src/stores/*.ts',
    '!/src/stores/*.test.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
)

const ENTRY = '/src/platform/index.ts'
const SWAP_POINT = '/src/platform/runtime.ts'
const WEB_DIR = '/src/platform/web/'
const WEB_TRANSPORT = /^(axios|laravel-echo|pusher-js)(\/|$)/

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function specifiers(source: string): string[] {
  return [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')
}

function resolve(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = `/src/${spec.slice(2)}`
  else if (spec.startsWith('.')) base = new URL(spec, `file://${from}`).pathname
  else return null
  if (/\.(json|css)$/.test(base)) return base
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (candidate in sources) return candidate
  }
  throw new Error(`${from}: cannot resolve ${spec} inside the scanned set`)
}

interface Graph {
  files: Set<string>
  packages: Map<string, Set<string>>
}

function walk(entry: string, stopAt: string[] = []): Graph {
  const files = new Set<string>()
  const packages = new Map<string, Set<string>>()
  const queue = [entry]
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (files.has(file) || stopAt.includes(file)) continue
    files.add(file)
    const source = sources[file]
    if (source === undefined) continue
    for (const spec of specifiers(source)) {
      const target = resolve(file, spec)
      if (target === null) {
        const users = packages.get(spec) ?? new Set<string>()
        users.add(file)
        packages.set(spec, users)
      } else {
        queue.push(target)
      }
    }
  }
  return { files, packages }
}

describe('@/platform module graph', () => {
  it('finds the sources it scans', () => {
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining([
        ENTRY,
        SWAP_POINT,
        '/src/platform/shared.ts',
        '/src/platform/web/http.ts',
      ]),
    )
    expect(specifiers("import a from 'x'\nexport { b } from \"./y\"\nimport './z'")).toEqual([
      'x',
      './y',
      './z',
    ])
  })

  it('index.ts reaches the web adapter only through runtime.ts', () => {
    const { files } = walk(ENTRY, [SWAP_POINT])
    expect([...files].filter((f) => f.startsWith(WEB_DIR))).toEqual([])
    expect(walk(ENTRY).files).toContain(SWAP_POINT)
  })

  it('keeps axios, echo and pusher out of the graph except under ./web/', () => {
    const { packages } = walk(ENTRY)
    const leaks: string[] = []
    for (const [pkg, users] of packages) {
      if (!WEB_TRANSPORT.test(pkg)) continue
      for (const user of users) if (!user.startsWith(WEB_DIR)) leaks.push(`${user} -> ${pkg}`)
    }
    expect(leaks).toEqual([])
    expect(packages.get('axios')).toEqual(new Set(['/src/platform/web/http.ts']))
  })

  it('without the swap point no web transport package is reachable', () => {
    const { packages } = walk(ENTRY, [SWAP_POINT])
    expect([...packages.keys()].filter((p) => WEB_TRANSPORT.test(p))).toEqual([])
  })
})
