// Where the sync screens get their platform pieces: a provider (tests, or a
// future composition root) or else the running platform, loaded on first use.

import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react'

import { platformSyncDeps, type SyncDeps } from '../../sync'

const SyncDepsContext = createContext<SyncDeps | null>(null)

export function SyncDepsProvider({ deps, children }: { deps: SyncDeps; children: ReactNode }) {
  return createElement(SyncDepsContext.Provider, { value: deps }, children)
}

const noSubscription = () => () => undefined
const nothing = () => null

/** `null` until the platform is known. */
export function useSyncDeps(): SyncDeps | null {
  const provided = useContext(SyncDepsContext)
  const loaded = useSyncExternalStore(
    provided ? noSubscription : platformSyncDeps.subscribe,
    provided ? nothing : platformSyncDeps.get,
  )
  return provided ?? loaded
}
