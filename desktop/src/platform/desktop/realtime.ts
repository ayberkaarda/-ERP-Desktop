// `Realtime` over the shell's socket. The shell connects and subscribes the
// user channel itself; this side maps `realtime-event` to the private channel
// events the web features listen to. Events of another profile are dropped.

import { listenRealtime, type Listen, type RealtimeEventDto, type Unlisten } from '../../bridge/events'
import type { RealtimeStatusDto } from '../../bridge/generated/RealtimeStatusDto'
import { call, type Invoke } from '../../bridge/invoke'
import type { ActiveProfile } from './profile'
import type { Realtime, RealtimeState, SubscriptionStatus } from './u1-shim'

/** Web event names (with Echo's leading dot) of each shell event type. */
export const REALTIME_EVENT_NAMES = {
  session_revoked: '.session.revoked',
  membership_revoked: '.membership.revoked',
  notification_created: '.notification.created',
} as const

const KNOWN_EVENTS: readonly string[] = Object.values(REALTIME_EVENT_NAMES)
// The only private channel the shell subscribes: the signed-in user's.
const USER_CHANNEL = /^user\.[^.\s]+$/

type MessageEvent = Exclude<RealtimeEventDto, { type: 'state' }>

function payloadOf(event: MessageEvent): unknown {
  switch (event.type) {
    case 'session_revoked':
      return { reason: event.reason }
    case 'membership_revoked':
      return { company_id: event.company_id }
    case 'notification_created':
      return event.notification
  }
}

interface Subscription {
  event: string
  handler: (payload: unknown) => void
  onStatus: ((status: SubscriptionStatus) => void) | undefined
}

export interface DesktopRealtime extends Realtime {
  dispose(): void
}

export function createDesktopRealtime(options: {
  invoke: Invoke
  listen: Listen
  profile: ActiveProfile
}): DesktopRealtime {
  const { invoke, listen, profile } = options
  let state: RealtimeState = 'idle'
  let version = 0
  const stateListeners = new Set<(state: RealtimeState) => void>()
  const subscriptions = new Set<Subscription>()

  const setState = (next: RealtimeState) => {
    if (next === state) return
    state = next
    for (const listener of [...stateListeners]) listener(next)
    if (next === 'connected') {
      for (const sub of [...subscriptions]) sub.onStatus?.('subscribed')
    }
  }

  const readStatus = (id: string) => {
    const asked = version
    void call<RealtimeStatusDto>(invoke, 'realtime_status').then(
      (status) => {
        if (asked !== version || status.profile_id !== id || profile.current() !== id) return
        setState(status.state)
      },
      () => undefined,
    )
  }

  const stopProfile = profile.subscribe((id) => {
    version += 1
    setState('idle')
    if (id !== null) readStatus(id)
  })

  const unlisten: Promise<Unlisten> = listenRealtime(listen, (event) => {
    profile.accept(event.profile_id, () => {
      if (event.type === 'state') {
        version += 1
        setState(event.state)
        return
      }
      const name = REALTIME_EVENT_NAMES[event.type]
      const payload = payloadOf(event)
      for (const sub of [...subscriptions]) if (sub.event === name) sub.handler(payload)
    })
  })

  return {
    connect: () => undefined,
    disconnect: () => undefined,
    state: () => state,
    subscribe: (listener) => {
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    listenPrivate: (channel, event, handler, onStatus) => {
      const sub: Subscription = { event, handler, onStatus }
      if (!USER_CHANNEL.test(channel) || !KNOWN_EVENTS.includes(event)) {
        // Nothing would ever arrive: say so instead of staying silent.
        queueMicrotask(() => onStatus?.('error'))
        return () => undefined
      }
      subscriptions.add(sub)
      if (state === 'connected') {
        queueMicrotask(() => {
          if (subscriptions.has(sub) && state === 'connected') onStatus?.('subscribed')
        })
      }
      return () => {
        subscriptions.delete(sub)
      }
    },
    dispose: () => {
      stopProfile()
      subscriptions.clear()
      void unlisten.then((stop) => {
        stop()
      })
    },
  }
}
