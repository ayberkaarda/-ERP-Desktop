// App code reaches the runtime only through @/platform; a direct import of the web adapter
// would put axios into a build that swaps platform/runtime.ts. Tests may build web clients.
const sources = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx}', '!/src/platform/**', '!/src/**/*.test.{ts,tsx}', '!/src/test/**'],
  { query: '?raw', import: 'default', eager: true },
)

const WEB_ADAPTER =
  /from\s*['"](?:@\/platform\/web|(?:\.\.?\/)+(?:\.\.\/)*platform\/web)(?:\/[^'"]*)?['"]|import\(\s*['"]@\/platform\/web/

// Files outside src/platform allowed to import the web adapter directly.
const ALLOWED: string[] = []

describe('web adapter boundary', () => {
  it('scans app sources', () => {
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(['/src/main.tsx', '/src/components/shared/attachments/filesApi.ts']),
    )
    expect(WEB_ADAPTER.test("import { x } from '@/platform/web/http'")).toBe(true)
    expect(WEB_ADAPTER.test("import { x } from '../../platform/web'")).toBe(true)
    expect(WEB_ADAPTER.test("import { x } from '@/platform'")).toBe(false)
  })

  it('no file outside src/platform imports @/platform/web', () => {
    const offenders = Object.entries(sources)
      .filter(([file, source]) => WEB_ADAPTER.test(source) && !ALLOWED.includes(file))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
