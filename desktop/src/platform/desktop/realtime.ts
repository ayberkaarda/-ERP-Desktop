// `Realtime` over the shell's socket. The shell connects and subscribes the
// user channel itself; this side maps `realtime-event` to the private channel
// events the web features listen to. Events of another profile are dropped.
// A listener hears 'subscribed' only once the server accepted its channel on
// the current socket (a connected socket alone is not enough), and 'error'
// when the subscription was refused.

import { listenRealtime, type Listen, type RealtimeEventDto, type Unlisten } from '../../bridge/events'
import type { RealtimeStatusDto } from '../../bridge/generated/RealtimeStatusDto'
import { call, type Invoke } from '../../bridge/invoke'
import type { ActiveProfile } from './profile'
import type { Realtime, RealtimeState, SubscriptionStatus } from '@/platform/types'

/** Web event names (with Echo's leading dot) of each shell event type. */
export const REALTIME_EVENT_NAMES = {
  session_revoked: '.session.revoked',
  membership_revoked: '.membership.revoked',
  notification_created: '.notification.created',
} as const

const KNOWN_EVENTS: readonly string[] = Object.values(REALTIME_EVENT_NAMES)
// The only private channel the shell subscribes: the signed-in user's.
const USER_CHANNEL = /^user\.[^.\s]+$/

type MessageEvent = Exclude<
  RealtimeEventDto,
  { type: 'state' } | { type: 'subscribed' } | { type: 'subscription_failed' }
>

/** Pusher name of a private channel (what the shell reports). */
const pusherName = (channel: string) => `private-${channel}`

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
  channel: string
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
  // Channels (Pusher names) the server accepted on the current socket.
  const accepted = new Set<string>()
  // Channels the server refused on the current socket: a listener added later
  // is told too, not left waiting for an answer that already came.
  const refused = new Set<string>()

  const setState = (next: RealtimeState) => {
    // Any state but connected: the socket and its subscriptions are gone.
    if (next !== 'connected') {
      accepted.clear()
      refused.clear()
    }
    if (next === state) return
    state = next
    for (const listener of [...stateListeners]) listener(next)
  }

  const report = (channel: string, status: SubscriptionStatus) => {
    for (const sub of [...subscriptions]) {
      if (pusherName(sub.channel) === channel) sub.onStatus?.(status)
    }
  }

  const accept = (channel: string) => {
    if (state !== 'connected' || accepted.has(channel)) return
    accepted.add(channel)
    refused.delete(channel)
    report(channel, 'subscribed')
  }

  const readStatus = (id: string) => {
    const asked = version
    void call<RealtimeStatusDto>(invoke, 'realtime_status').then(
      (status) => {
        if (asked !== version || status.profile_id !== id || profile.current() !== id) return
        setState(status.state)
        if (Array.isArray(status.subscribed)) for (const channel of status.subscribed) accept(channel)
      },
      () => undefined,
    )
  }

  const stopProfile = profile.subscribe((id) => {
    version += 1
    setState('idle')
    if (id !== null) readStatus(id)
  })

  // A failed listen (no Tauri runtime, e.g. jsdom) hears nothing and must not
  // surface as an unhandled rejection.
  const unlisten: Promise<Unlisten> = listenRealtime(listen, (event) => {
    profile.accept(event.profile_id, () => {
      switch (event.type) {
        case 'state':
          version += 1
          setState(event.state)
          return
        case 'subscribed': {
          // Sent after the state of its socket. Not connected here: either
          // that socket is gone, or its state came before the first
          // realtime_status answer, which may predate the subscription.
          // The shell records a subscription before it reports it, so a
          // fresh read settles both.
          if (state === 'connected') {
            accept(event.channel)
            return
          }
          const id = profile.current()
          if (id) readStatus(id)
          return
        }
        case 'subscription_failed':
          accepted.delete(event.channel)
          refused.add(event.channel)
          report(event.channel, 'error')
          return
      }
      const name = REALTIME_EVENT_NAMES[event.type]
      const payload = payloadOf(event)
      for (const sub of [...subscriptions]) if (sub.event === name) sub.handler(payload)
    })
  }).catch((): Unlisten => () => undefined)

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
      const sub: Subscription = { channel, event, handler, onStatus }
      if (!USER_CHANNEL.test(channel) || !KNOWN_EVENTS.includes(event)) {
        // Nothing would ever arrive: say so instead of staying silent.
        queueMicrotask(() => onStatus?.('error'))
        return () => undefined
      }
      subscriptions.add(sub)
      if (refused.has(pusherName(channel))) {
        queueMicrotask(() => {
          if (subscriptions.has(sub) && refused.has(pusherName(channel))) onStatus?.('error')
        })
      } else if (accepted.has(pusherName(channel))) {
        queueMicrotask(() => {
          if (subscriptions.has(sub) && accepted.has(pusherName(channel))) onStatus?.('subscribed')
        })
      }
      return () => {
        subscriptions.delete(sub)
      }
    },
    dispose: () => {
      stopProfile()
      subscriptions.clear()
      accepted.clear()
      refused.clear()
      void unlisten.then((stop) => {
        stop()
      })
    },
  }
}
