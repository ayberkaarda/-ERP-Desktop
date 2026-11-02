// The fixture set is for tests. A window module that reaches it puts the
// contract fixtures into dist (bundle.test.ts shows what one call pulls in),
// so only tests, src/test/** and the wire package's own loader may name it.
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/bridge/generated/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const FIXTURE_NAMES =
  /\b(wireFixtures|wireFixture|validFixture|conflictFixtures|conflictDtoFixtures|VALID_FIXTURES|INVALID_FIXTURES|FIXTURE_SCHEMAS)\b|generated\/fixtures/

// Files allowed to name the fixture set, relative to src/.
const ALLOWED = new Set(['wire/index.ts', 'wire/fixtures.ts', 'wire/generated/fixtures.ts'])

function isTestOnly(file: string): boolean {
  return /\.test\.tsx?$/.test(file) || file.startsWith('test/')
}

/** Window modules (src-relative) that name the fixture set. */
function fixtureUsers(files: Record<string, string>): string[] {
  return Object.entries(files)
    .map(([file, text]) => [file.replace(/^\/src\//, ''), text] as const)
    .filter(([file, text]) => !isTestOnly(file) && !ALLOWED.has(file) && FIXTURE_NAMES.test(text))
    .map(([file]) => file)
    .sort()
}

describe('fixture boundary', () => {
  it('scans the window sources', () => {
    const files = Object.keys(sources).map((f) => f.replace(/^\/src\//, ''))
    expect(files).toContain('main.tsx')
    expect(files).toContain('wire/onlineOnly.ts')
    expect(files).toContain('wire/fixtures.ts')
  })

  it('keeps the fixture set out of every window module', () => {
    expect(fixtureUsers(sources)).toEqual([])
  })

  it('flags a window module that reaches the fixtures', () => {
    expect(
      fixtureUsers({
        '/src/main.tsx': "import { wireFixtures } from '@desktop/wire'\nwireFixtures()",
        '/src/ui/sync/Inbox.tsx': "import * as wire from '../../wire'\nwire.conflictDtoFixtures()",
        '/src/wire/onlineOnly.ts': "import { ONLINE_ONLY } from './generated/fixtures'",
        '/src/ui/sync/Inbox.test.tsx': "import { conflictDtoFixtures } from '@desktop/wire'",
        '/src/test/fakeBridge.ts': "import { validFixture } from '../wire'",
        '/src/wire/conflicts.ts': "import { RESOLUTION_TABLE } from './conflicts'",
      }),
    ).toEqual(['main.tsx', 'ui/sync/Inbox.tsx', 'wire/onlineOnly.ts'])
  })
})
