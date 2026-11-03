// Sync state of the active profile: the engine status and the realtime state,
// read with `sync_status` / `realtime_status` first (events sent before the
// webview listened are lost), then kept current by `engine-event` and
// `realtime-event`. Events of another profile are dropped.

import { createStore } from 'zustand/vanilla'

import { listenEngine, listenRealtime, type Listen, type Unlisten } from '../bridge/events'
import type { RealtimeStateDto } from '../bridge/generated/RealtimeStateDto'
import type { RealtimeStatusDto } from '../bridge/generated/RealtimeStatusDto'
import type { StatusDto } from '../bridge/generated/StatusDto'
import { call, type Invoke } from '../bridge/invoke'

export interface SyncBridge {
  invoke: Invoke
  listen: Listen
}

export interface SyncSnapshot {
  /** `undefined` until the first read; `null` when no profile is active. */
  profileId: string | null | undefined
  /** `null` while the active profile has no engine (no company, no local store). */
  status: StatusDto | null
  realtime: RealtimeStateDto | null
  /**
   * The user channel on a connected socket: `live` once the server accepted
   * it, `denied` when it refused it, `waiting` while neither is known;
   * `null` while the socket is not connected.
   */
  channel: ChannelState | null
  /** Clock time the status arrived; `retry_after` counts from here. */
  statusAt: number
}

export type ChannelState = 'live' | 'denied' | 'waiting'

export interface ResourcesChange {
  resources: string[]
  all: boolean
}

export interface SyncStore {
  getState: () => SyncSnapshot
  subscribe: (listener: () => void) => () => void
  /** Reads the first values and starts listening (only the first call does). */
  start(): void
  dispose(): void
  /** `sync_now`; rejects with the `CommandError`. */
  syncNow(): Promise<void>
  /** Reads `sync_status` again (after an outbox or conflict command). */
  refreshStatus(): Promise<void>
  onResourcesChanged(listener: (change: ResourcesChange) => void): () => void
}

/** The channel state a `realtime_status` answer shows (a refusal is kept). */
function channelOf(
  realtime: RealtimeStateDto,
  subscribed: readonly string[] | undefined,
  before: ChannelState | null,
): ChannelState | null {
  if (realtime !== 'connected') return null
  if (Array.isArray(subscribed) && subscribed.length > 0) return 'live'
  return before === 'denied' ? 'denied' : 'waiting'
}

const shared = new WeakMap<SyncBridge, SyncStore>()

/** The one started store of a bridge, shared by the badges and the pages. */
export function syncStoreFor(bridge: SyncBridge): SyncStore {
  let store = shared.get(bridge)
  if (!store) {
    store = createSyncStore(bridge)
    shared.set(bridge, store)
  }
  store.start()
  return store
}

export function createSyncStore(bridge: SyncBridge, options: { now?: () => number } = {}): SyncStore {
  const { invoke, listen } = bridge
  const now = options.now ?? Date.now
  const state = createStore<SyncSnapshot>(() => ({
    profileId: undefined,
    status: null,
    realtime: null,
    channel: null,
    statusAt: 0,
  }))
  const changeListeners = new Set<(change: ResourcesChange) => void>()
  // Bumped by every status event, so an older `sync_status` answer is not applied over it.
  let version = 0
  let started = false
  let disposed = false
  let checking: Promise<string | null> | null = null
  const unlisteners: Promise<Unlisten>[] = []

  const setStatus = (status: StatusDto | null) => {
    state.setState({ status, statusAt: now() })
  }

  const readStatus = async () => {
    const asked = version
    let status: StatusDto | null
    try {
      status = await call<StatusDto>(invoke, 'sync_status')
    } catch {
      status = null
    }
    if (asked === version && !disposed) setStatus(status)
  }

  // The active profile as the shell sees it now (shared by concurrent callers).
  const checkProfile = (): Promise<string | null> => {
    checking ??= call<RealtimeStatusDto>(invoke, 'realtime_status')
      .then(
        (dto) => {
          const before = state.getState().profileId
          state.setState({
            profileId: dto.profile_id,
            realtime: dto.state,
            channel: channelOf(dto.state, dto.subscribed, state.getState().channel),
          })
          // Another profile: its engine (or the lack of one) replaces the last
          // profile's status. The first read is already paired with one.
          if (before !== undefined && before !== dto.profile_id && !disposed) void readStatus()
          return dto.profile_id
        },
        () => null,
      )
      .finally(() => {
        checking = null
      })
    return checking
  }

  // Runs `deliver` for an event of the active profile; another id is checked
  // once (a switch this store has not seen yet), then dropped if still foreign.
  const accept = (profileId: string, deliver: () => void) => {
    if (state.getState().profileId === profileId) {
      deliver()
      return
    }
    void checkProfile().then((id) => {
      if (id === profileId && !disposed) deliver()
    })
  }

  // A refused listen (no shell) leaves the store on its first reads.
  const kept = (unlisten: Promise<Unlisten>): Promise<Unlisten> => unlisten.catch((): Unlisten => () => undefined)

  const start = () => {
    if (started) return
    started = true
    unlisteners.push(
      kept(listenEngine(listen, (event) => {
        if (event.type === 'status') {
          accept(event.profile_id, () => {
            version += 1
            setStatus(event.status)
          })
        } else if (event.type === 'resources_changed') {
          const change = { resources: event.resources, all: event.all }
          accept(event.profile_id, () => {
            for (const listener of [...changeListeners]) listener(change)
          })
        }
      })),
      kept(listenRealtime(listen, (event) => {
        if (event.type === 'state') {
          accept(event.profile_id, () => {
            const before = state.getState()
            // A new socket has no subscription yet.
            const channel =
              event.state !== 'connected' ? null : before.realtime === 'connected' ? before.channel : 'waiting'
            state.setState({ realtime: event.state, channel })
          })
        } else if (event.type === 'subscribed' || event.type === 'subscription_failed') {
          const channel: ChannelState = event.type === 'subscribed' ? 'live' : 'denied'
          accept(event.profile_id, () => {
            if (state.getState().realtime === 'connected') state.setState({ channel })
            else void checkProfile()
          })
        }
      })),
    )
    void checkProfile()
    void readStatus()
  }

  return {
    getState: () => state.getState(),
    subscribe: (listener) => state.subscribe(listener),
    start,
    dispose: () => {
      disposed = true
      for (const unlisten of unlisteners.splice(0)) {
        void unlisten.then(
          (stop) => {
            stop()
          },
          () => undefined,
        )
      }
      changeListeners.clear()
    },
    syncNow: () => call<undefined>(invoke, 'sync_now').then(() => undefined),
    refreshStatus: readStatus,
    onResourcesChanged: (listener) => {
      changeListeners.add(listener)
      return () => {
        changeListeners.delete(listener)
      }
    },
  }
}
