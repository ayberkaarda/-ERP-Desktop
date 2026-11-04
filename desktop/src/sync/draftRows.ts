// Which list rows carry a change not sent yet, for the web `useDraftRows`:
// the `meta.offline.draft_ids` of the last local list answer of each API
// path, as the offline meta store holds them. A network answer for a path
// removes its ids, as it removes the path's freshness label. Ids are UUIDs,
// so the ids of every path can be joined: a row is named by its own
// resource's answer only.

import { useSyncExternalStore } from 'react'

import type { OfflineMetaSource } from './freshness'

export interface DraftRows {
  /** The same set object until the ids change. */
  current: () => ReadonlySet<string>
  subscribe: (listener: () => void) => () => void
}

const NONE: ReadonlySet<string> = new Set()

function idsOf(source: OfflineMetaSource): Set<string> {
  const ids = new Set<string>()
  for (const path of source.paths()) {
    for (const id of source.get(path)?.draft_ids ?? []) ids.add(id)
  }
  return ids
}

function same(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

export function createDraftRows(source: OfflineMetaSource): DraftRows {
  const listeners = new Set<() => void>()
  let ids: ReadonlySet<string> = NONE
  let stop: (() => void) | null = null

  const refresh = (): boolean => {
    const next = idsOf(source)
    if (same(ids, next)) return false
    ids = next.size === 0 ? NONE : next
    return true
  }

  return {
    current: () => {
      // Without listeners the source is not followed: read it now.
      if (stop === null) refresh()
      return ids
    },
    subscribe: (listener) => {
      listeners.add(listener)
      if (stop === null) {
        refresh()
        stop = source.subscribe(() => {
          if (refresh()) for (const l of [...listeners]) l()
        })
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && stop !== null) {
          stop()
          stop = null
        }
      }
    },
  }
}

const bySource = new WeakMap<OfflineMetaSource, DraftRows>()

/** One `DraftRows` per source, so every table shares it. */
export function draftRowsOf(source: OfflineMetaSource): DraftRows {
  let rows = bySource.get(source)
  if (!rows) {
    rows = createDraftRows(source)
    bySource.set(source, rows)
  }
  return rows
}

const noRows: DraftRows = { current: () => NONE, subscribe: () => () => undefined }

/** The ids of rows with an unsent change; none without an offline meta store (web). */
export function useDraftRowsState(source: OfflineMetaSource | null): ReadonlySet<string> {
  const rows = source ? draftRowsOf(source) : noRows
  return useSyncExternalStore(rows.subscribe, rows.current)
}
