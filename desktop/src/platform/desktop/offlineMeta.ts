// `meta.offline` of the last local answer per API path, for the freshness label.
// The body keeps its own copy; this store only lets the UI read it by path.

/** `meta.offline` as the shell writes it (`router/envelope.rs` `with_offline`). */
export interface OfflineMeta {
  as_of?: string
  partial: boolean
  stale: boolean
  /** The answer shows a queued draft. */
  pending?: boolean
  /** Of a list page: ids of its rows that carry a queued draft, in page order. */
  draft_ids?: string[]
  unsupported_filters?: string[]
}

export interface OfflineMetaStore {
  /** Meta of the last local answer of `path` (API-relative, no query: `/parties`). */
  get(path: string): OfflineMeta | undefined
  /** The paths that have a meta now. */
  paths(): string[]
  /** `undefined` forgets the path (a network answer came). */
  record(path: string, meta: OfflineMeta | undefined): void
  clear(): void
  /**
   * Called after every change with the changed path; `clear` calls it once per
   * forgotten path, after the whole store is empty.
   */
  subscribe(listener: (path: string) => void): () => void
}

export function createOfflineMetaStore(): OfflineMetaStore {
  const entries = new Map<string, OfflineMeta>()
  const listeners = new Set<(path: string) => void>()
  const changed = (paths: string[]) => {
    for (const path of paths) {
      for (const listener of [...listeners]) listener(path)
    }
  }
  return {
    get: (path) => entries.get(path),
    paths: () => [...entries.keys()],
    record: (path, meta) => {
      if (meta === undefined) {
        if (entries.delete(path)) changed([path])
        return
      }
      entries.set(path, meta)
      changed([path])
    },
    clear: () => {
      if (entries.size === 0) return
      const paths = [...entries.keys()]
      entries.clear()
      changed(paths)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
