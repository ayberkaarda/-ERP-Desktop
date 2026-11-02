// @vitest-environment node
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { build, type Rollup } from 'vite'
import { describe, expect, it } from 'vitest'

import { moduleSwap, type ModuleSwap } from './moduleSwap'
import { DESKTOP_SWAPS } from './swaps'

const fixture = (path: string) => fileURLToPath(new URL(`./fixtures/swap/${path}`, import.meta.url))

const RUNTIME: ModuleSwap = { replaced: fixture('upstream/runtime.js'), by: fixture('desktop/runtime.js') }
const EXTENSIONS: ModuleSwap = {
  replaced: fixture('upstream/extensions.js'),
  by: fixture('desktop/extensions.js'),
}

// Bundles fixtures/swap/entry.js in memory with the plugin and returns the code.
async function bundle(swaps: readonly ModuleSwap[]): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: fixture(''),
    resolve: { alias: { '@up': fixture('upstream') } },
    plugins: [moduleSwap(swaps)],
    build: {
      write: false,
      minify: false,
      lib: { entry: fixture('entry.js'), formats: ['es'], fileName: 'out' },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RolldownOutput[]
  return outputs
    .flatMap((output) => output.output)
    .map((item) => (item.type === 'chunk' ? item.code : ''))
    .join('\n')
}

describe('moduleSwap', () => {
  it('replaces a module reached by a relative and by an aliased specifier', async () => {
    const code = await bundle([RUNTIME, EXTENSIONS])
    expect(code).toContain('desktop-runtime')
    expect(code).toContain('desktop-extensions')
    expect(code).not.toContain('web-runtime')
    expect(code).not.toContain('web-extensions')
  })

  it('leaves modules outside the table alone', async () => {
    const code = await bundle([RUNTIME])
    expect(code).toContain('desktop-runtime')
    expect(code).toContain('web-extensions')
  })

  it('matches the file, not the spelling of its path', async () => {
    const shouted = process.platform === 'win32' ? RUNTIME.replaced.toUpperCase() : RUNTIME.replaced
    const code = await bundle([{ ...RUNTIME, replaced: shouted }])
    expect(code).toContain('desktop-runtime')
  })

  it('stops the build when the upstream module is gone', async () => {
    await expect(
      bundle([{ replaced: fixture('upstream/moved.js'), by: RUNTIME.by }]),
    ).rejects.toThrow(/upstream\/moved\.js does not exist; the upstream module moved/)
  })

  it('stops the build when the replacement is missing', async () => {
    await expect(
      bundle([{ replaced: RUNTIME.replaced, by: fixture('desktop/missing.js') }]),
    ).rejects.toThrow(/the replacement .*desktop\/missing\.js does not exist/)
  })

  it('stops the build when nothing imports the upstream module any more', async () => {
    await expect(
      bundle([RUNTIME, { replaced: fixture('upstream/unused.js'), by: RUNTIME.by }]),
    ).rejects.toThrow(/nothing imports .*unused\.js; the upstream import graph changed/)
  })
})

describe('DESKTOP_SWAPS', () => {
  const tail = (path: string) => path.replace(/\\/g, '/').replace(/^.*\/(frontend|desktop)\//, '$1/')

  it('replaces the web platform runtime and the app extensions with desktop modules', () => {
    expect(DESKTOP_SWAPS.map((swap) => [tail(swap.replaced), tail(swap.by)])).toEqual([
      ['frontend/src/platform/runtime.ts', 'desktop/src/platform/runtime.ts'],
      ['frontend/src/app/extensions.tsx', 'desktop/src/app/extensions.tsx'],
    ])
  })

  it('points at files that exist', () => {
    for (const swap of DESKTOP_SWAPS) {
      expect(existsSync(swap.replaced), swap.replaced).toBe(true)
      expect(existsSync(swap.by), swap.by).toBe(true)
    }
  })
})
