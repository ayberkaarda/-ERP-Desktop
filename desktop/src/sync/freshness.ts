// What the freshness strip says about the page on screen: the `meta.offline`
// of the answers the page shows (`show`, see ./pageResources), as the offline
// meta store holds them: the last local answer of each API path. A network
// answer for a path removes that path's label. Answers of other paths (a
// picker's lookup, the header's own reads, the page before) say nothing about
// the page. A page shown from the query cache keeps the label of the local
// answer it was filled with.

import { NO_PAGE, type PageScope } from './pageResources'
import type { OfflineMeta } from '../platform'

/** The part of the platform's offline meta store the tracker reads. */
export interface OfflineMetaSource {
  get(path: string): OfflineMeta | undefined
  /** The paths that have a meta now. */
  paths(): string[]
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
  /** `null` when no answer the page shows came from this device. */
  current: () => Freshness | null
  /** The page on screen now; before the first call no page is shown. */
  show: (page: PageScope) => void
  subscribe: (listener: () => void) => () => void
  /** Starts following the source; returns the stop function. */
  start: () => () => void
}

export function createFreshnessTracker(source: OfflineMetaSource): FreshnessTracker {
  const listeners = new Set<() => void>()
  let page: PageScope = NO_PAGE
  let snapshot: Freshness | null = null

  const compute = (): Freshness | null => {
    const metas = source
      .paths()
      .filter((path) => page.shows(path))
      .map((path) => source.get(path))
      .filter((m): m is OfflineMeta => m !== undefined)
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
    show: (next) => {
      page = next
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
        if (page.shows(path)) changed()
      }),
  }
}
