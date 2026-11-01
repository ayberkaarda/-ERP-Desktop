// `meta.offline` of the last local answer per API path, for the freshness label.
// The body keeps its own copy; this store only lets the UI read it by path.

/** `meta.offline` as the shell writes it (`router/envelope.rs` `with_offline`). */
export interface OfflineMeta {
  as_of?: string
  partial: boolean
  stale: boolean
  pending?: number
  unsupported_filters?: string[]
}

export interface OfflineMetaStore {
  /** Meta of the last local answer of `path` (API-relative, no query: `/parties`). */
  get(path: string): OfflineMeta | undefined
  /** `undefined` forgets the path (a network answer came). */
  record(path: string, meta: OfflineMeta | undefined): void
  clear(): void
  /** Called after every change. */
  subscribe(listener: () => void): () => void
}

export function createOfflineMetaStore(): OfflineMetaStore {
  const entries = new Map<string, OfflineMeta>()
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    get: (path) => entries.get(path),
    record: (path, meta) => {
      if (meta === undefined) {
        if (entries.delete(path)) changed()
        return
      }
      entries.set(path, meta)
      changed()
    },
    clear: () => {
      if (entries.size === 0) return
      entries.clear()
      changed()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
