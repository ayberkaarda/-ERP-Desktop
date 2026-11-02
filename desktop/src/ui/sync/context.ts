// Where the sync screens get their platform pieces: a provider (tests) or the
// running platform. The deps of the running platform are built once, so the
// objects screens subscribe to keep their identity across renders.

import { createContext, createElement, useContext, type ReactNode } from 'react'

import { syncDepsOf, type SyncDeps } from '../../sync'
import { platform } from '@/platform'

const SyncDepsContext = createContext<SyncDeps | null>(null)

export function SyncDepsProvider({ deps, children }: { deps: SyncDeps; children: ReactNode }) {
  return createElement(SyncDepsContext.Provider, { value: deps }, children)
}

let running: SyncDeps | null = null

function runningDeps(): SyncDeps {
  running ??= syncDepsOf(platform)
  return running
}

export function useSyncDeps(): SyncDeps {
  return useContext(SyncDepsContext) ?? runningDeps()
}
