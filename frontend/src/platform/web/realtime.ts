import type { Realtime, RealtimeState, SubscriptionStatus } from '../types'

interface ChannelAuthorizationData {
  auth: string
  channel_data?: string
  shared_secret?: string
}
export interface ReverbConfig {
  key: string
  host: string
  port: number
  tls: boolean
}

export interface WebRealtimeOptions {
  config: ReverbConfig | null
  /** Signs a private channel subscription through the authenticated HTTP client. */
  authorize: (socketId: string, channelName: string) => Promise<unknown>
}

interface Listener {
  channel: string
  event: string
  handler: (payload: unknown) => void
  onStatus?: ((status: SubscriptionStatus) => void) | undefined
}

interface EchoLike {
  private(channel: string): {
    listen(event: string, cb: (payload: unknown) => void): unknown
    stopListening(event: string, cb?: (payload: unknown) => void): unknown
    subscribed(cb: () => void): unknown
    error(cb: (error: unknown) => void): unknown
  }
  leave(channel: string): void
  disconnect(): void
}

/** Reads VITE_REVERB_* at build time; a missing key disables realtime instead of failing. */
export function reverbConfigFromEnv(env: Record<string, unknown>): ReverbConfig | null {
  const key = typeof env.VITE_REVERB_APP_KEY === 'string' ? env.VITE_REVERB_APP_KEY.trim() : ''
  if (!key) return null
  const host =
    typeof env.VITE_REVERB_HOST === 'string' && env.VITE_REVERB_HOST
      ? env.VITE_REVERB_HOST
      : window.location.hostname
  const tls = env.VITE_REVERB_SCHEME === 'https'
  const port = Number(env.VITE_REVERB_PORT) || (tls ? 443 : 80)
  return { key, host, port, tls }
}

function isAuthData(value: unknown): value is ChannelAuthorizationData {
  return (
    typeof value === 'object' && value !== null && 'auth' in value && typeof value.auth === 'string'
  )
}

export function createWebRealtime(options: WebRealtimeOptions): Realtime {
  const listeners = new Set<Listener>()
  const stateListeners = new Set<(state: RealtimeState) => void>()
  let state: RealtimeState = options.config ? 'idle' : 'disabled'
  let echo: EchoLike | null = null
  // Bumped on disconnect so a slow lazy import cannot resurrect a closed session.
  let generation = 0

  function setState(next: RealtimeState) {
    if (next === state) return
    state = next
    stateListeners.forEach((l) => l(next))
  }

  function attach(l: Listener) {
    if (!echo) return
    const channel = echo.private(l.channel)
    channel.listen(l.event, l.handler)
    // Fires again after pusher resubscribes on reconnect.
    channel.subscribed(() => {
      if (listeners.has(l)) l.onStatus?.('subscribed')
    })
    channel.error(() => {
      if (listeners.has(l)) l.onStatus?.('error')
    })
  }

  async function open(config: ReverbConfig, gen: number) {
    // Socket libraries load only after login, keeping them out of the first paint.
    const [{ default: Echo }, { default: Pusher }] = await Promise.all([
      import('laravel-echo'),
      import('pusher-js'),
    ])
    if (gen !== generation) return
    const instance = new Echo({
      broadcaster: 'reverb',
      key: config.key,
      wsHost: config.host,
      wsPort: config.port,
      wssPort: config.port,
      forceTLS: config.tls,
      enabledTransports: ['ws', 'wss'],
      Pusher,
      channelAuthorization: {
        customHandler: ({ socketId, channelName }, callback) => {
          options.authorize(socketId, channelName).then(
            (data) =>
              isAuthData(data)
                ? callback(null, data)
                : callback(new Error('Invalid channel authorization'), null),
            () => callback(new Error('Channel authorization failed'), null),
          )
        },
      },
    })
    instance.connector.onConnectionChange((status) => {
      if (gen !== generation) return
      if (status === 'connected') setState('connected')
      else if (status === 'connecting' || status === 'reconnecting') setState('connecting')
      else setState('unavailable')
    })
    echo = instance
    listeners.forEach(attach)
  }

  return {
    connect() {
      const config = options.config
      if (!config || state !== 'idle') return
      setState('connecting')
      const gen = generation
      open(config, gen).catch(() => {
        if (gen === generation) setState('unavailable')
      })
    },
    disconnect() {
      generation += 1
      echo?.disconnect()
      echo = null
      if (options.config) setState('idle')
    },
    listenPrivate(channel, event, handler, onStatus) {
      const l: Listener = { channel, event, handler, onStatus }
      listeners.add(l)
      attach(l)
      return () => {
        listeners.delete(l)
        if (!echo) return
        echo.private(channel).stopListening(event, handler)
        if (![...listeners].some((x) => x.channel === channel)) echo.leave(channel)
      }
    },
    state: () => state,
    subscribe(listener) {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
  }
}
