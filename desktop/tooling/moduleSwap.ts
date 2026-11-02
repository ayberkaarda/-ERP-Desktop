import { existsSync } from 'node:fs'

import { normalizePath, type Plugin } from 'vite'

/** One upstream module and the file that takes its place in the bundle. */
export interface ModuleSwap {
  /** Absolute path of the upstream module (web `frontend/src`). */
  replaced: string
  /** Absolute path of the desktop module with the same exports. */
  by: string
}

// Resolved ids may carry a query (`?raw`) and, on Windows, either drive
// letter case; the file is what counts.
function fileKey(id: string): string {
  const file = normalizePath(id.split('?', 1)[0] ?? id)
  return process.platform === 'win32' ? file.toLowerCase() : file
}

/**
 * Replaces whole modules by absolute path, whatever specifier reached them
 * (`./runtime`, `@/app/extensions`, `../../platform/runtime`): each import is
 * resolved first and the result compared with the table.
 *
 * A swap that cannot hold stops the build: a missing upstream module (moved
 * or renamed upstream), a missing replacement, or, in a build, an upstream
 * module that nothing imported any more (its importers changed).
 */
export function moduleSwap(swaps: readonly ModuleSwap[]): Plugin {
  const table = new Map(swaps.map((swap) => [fileKey(swap.replaced), normalizePath(swap.by)]))
  const applied = new Set<string>()
  let command: 'build' | 'serve' = 'build'

  return {
    name: 'keystone:module-swap',
    enforce: 'pre',
    configResolved(config) {
      command = config.command
    },
    buildStart() {
      applied.clear()
      for (const swap of swaps) {
        if (!existsSync(swap.replaced)) {
          this.error(`module swap: ${normalizePath(swap.replaced)} does not exist; the upstream module moved`)
        }
        if (!existsSync(swap.by)) {
          this.error(`module swap: the replacement ${normalizePath(swap.by)} does not exist`)
        }
      }
    },
    async resolveId(source, importer, options) {
      if (importer === undefined) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved === null || resolved.external) return resolved
      const key = fileKey(resolved.id)
      const by = table.get(key)
      if (by === undefined) return resolved
      applied.add(key)
      return by
    },
    buildEnd(error) {
      if (error !== undefined || command !== 'build') return
      const unused = swaps.filter((swap) => !applied.has(fileKey(swap.replaced)))
      if (unused.length > 0) {
        this.error(
          `module swap: nothing imports ${unused.map((swap) => normalizePath(swap.replaced)).join(', ')}; ` +
            'the upstream import graph changed',
        )
      }
    },
  }
}
