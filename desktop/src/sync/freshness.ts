// What the freshness strip says about the page on screen: the `meta.offline`
// of the local answers its requests got since the page opened (`reset` on
// navigation). A network answer for a path removes that path's label.

import type { OfflineMeta } from '../platform'

/** The part of the platform's offline meta store the tracker reads. */
export interface OfflineMetaSource {
  get(path: string): OfflineMeta | undefined
  /** The listener gets the changed path. */
  subscribe(listener: (path: string) => void): () => void
}

export interface Freshness {
  stale: boolean
  partial: boolean
  /** The oldest `as_of` among the answers. */
  asOf: string | undefined
  unsupportedFilters: string[]
}

export interface FreshnessTracker {
  /** `null` when no answer on the page came from this device. */
  current: () => Freshness | null
  /** A new page: earlier answers no longer describe what is on screen. */
  reset: () => void
  subscribe: (listener: () => void) => () => void
  /** Starts following the source; returns the stop function. */
  start: () => () => void
}

export function createFreshnessTracker(source: OfflineMetaSource): FreshnessTracker {
  const paths = new Set<string>()
  const listeners = new Set<() => void>()
  let snapshot: Freshness | null = null

  const compute = (): Freshness | null => {
    const metas = [...paths].map((path) => source.get(path)).filter((m): m is OfflineMeta => m !== undefined)
    if (metas.length === 0) return null
    const asOfs = metas.map((m) => m.as_of).filter((v): v is string => typeof v === 'string')
    const filters = new Set(metas.flatMap((m) => m.unsupported_filters ?? []))
    return {
      stale: metas.some((m) => m.stale),
      partial: metas.some((m) => m.partial),
      asOf: asOfs.length > 0 ? asOfs.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)) : undefined,
      unsupportedFilters: [...filters].sort(),
    }
  }

  const changed = () => {
    snapshot = compute()
    for (const listener of [...listeners]) listener()
  }

  return {
    current: () => snapshot,
    reset: () => {
      paths.clear()
      changed()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start: () =>
      source.subscribe((path) => {
        paths.add(path)
        changed()
      }),
  }
}
