// @vitest-environment node
// A window module that uses the runtime tables of @desktop/wire must not pull
// the fixture set (tests only) into the bundle.
import { fileURLToPath } from 'node:url'

import { build, type Plugin, type Rollup } from 'vite'
import { describe, expect, it } from 'vitest'

const surface = fileURLToPath(new URL('./index.ts', import.meta.url))
const ENTRY = '\0wire-entry'

function entry(code: string): Plugin {
  return {
    name: 'wire-entry',
    enforce: 'pre',
    resolveId: (id) => (id.endsWith('wire-entry') ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  }
}

async function bundle(code: string): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [entry(code)],
    build: { write: false, minify: false, lib: { entry: 'wire-entry', formats: ['es'], fileName: 'out' } },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RolldownOutput[]
  return outputs
    .flatMap((output) => output.output)
    .map((item) => (item.type === 'chunk' ? item.code : ''))
    .join('\n')
}

const FIXTURE_TRACES = ['QUO2026000000118', 'Ege Hırdavat', 'reset-without-reason', 'VALID_FIXTURES']

describe('wire bundle', () => {
  it('carries the online-only table, the choice model and the error keys without the fixtures', async () => {
    const code = await bundle(
      `import { onlineOnlyAction, conflictModel, errorKey } from ${JSON.stringify(surface)}\n` +
        'export const used = [onlineOnlyAction, conflictModel, errorKey]\n',
    )
    expect(code).toContain('/api/v1/sales-quotes/{id}/send')
    expect(code).toContain('save_as_new_draft')
    for (const trace of FIXTURE_TRACES) expect(code, trace).not.toContain(trace)
  }, 60_000)

  it('finds the fixture traces when the fixtures are used', async () => {
    const code = await bundle(
      `import { wireFixtures } from ${JSON.stringify(surface)}\nexport const used = wireFixtures\n`,
    )
    for (const trace of FIXTURE_TRACES.slice(0, 2)) expect(code, trace).toContain(trace)
  }, 60_000)
})
