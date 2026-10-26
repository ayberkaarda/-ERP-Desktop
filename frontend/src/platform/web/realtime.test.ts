import { waitFor } from '@testing-library/react'
import { createWebRealtime, reverbConfigFromEnv } from './realtime'

const echo = vi.hoisted(() => {
  const listen = vi.fn()
  const stopListening = vi.fn()
  const leave = vi.fn()
  const disconnect = vi.fn()
  let onStatus: ((s: string) => void) | null = null
  const options: unknown[] = []
  const subscribedCbs: (() => void)[] = []
  const errorCbs: (() => void)[] = []
  class FakeEcho {
    connector = {
      onConnectionChange: (cb: (s: string) => void) => {
        onStatus = cb
        return () => undefined
      },
    }
    constructor(o: unknown) {
      options.push(o)
    }
    private() {
      return {
        listen,
        stopListening,
        subscribed: (cb: () => void) => subscribedCbs.push(cb),
        error: (cb: () => void) => errorCbs.push(cb),
      }
    }
    leave = leave
    disconnect = disconnect
  }
  return {
    FakeEcho,
    listen,
    stopListening,
    leave,
    disconnect,
    options,
    status: (s: string) => onStatus?.(s),
    subscribedCbs,
    errorCbs,
  }
})

vi.mock('laravel-echo', () => ({ default: echo.FakeEcho }))
vi.mock('pusher-js', () => ({ default: vi.fn() }))

const config = { key: 'k', host: 'localhost', port: 8080, tls: false }

describe('web realtime', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads VITE_REVERB_* and disables itself without a key', () => {
    expect(reverbConfigFromEnv({})).toBeNull()
    expect(
      reverbConfigFromEnv({
        VITE_REVERB_APP_KEY: 'k',
        VITE_REVERB_HOST: 'ws.test',
        VITE_REVERB_PORT: '443',
        VITE_REVERB_SCHEME: 'https',
      }),
    ).toEqual({ key: 'k', host: 'ws.test', port: 443, tls: true })

    const rt = createWebRealtime({ config: null, authorize: vi.fn() })
    rt.connect()
    const stop = rt.listenPrivate('user.1', '.x', vi.fn())
    stop()
    expect(rt.state()).toBe('disabled')
    expect(echo.options).toHaveLength(0)
  })

  it('connects lazily, attaches queued listeners and tracks state', async () => {
    const rt = createWebRealtime({ config, authorize: vi.fn() })
    const handler = vi.fn()
    const states: string[] = []
    rt.subscribe((s) => states.push(s))
    const stop = rt.listenPrivate('user.1', '.notification.created', handler)
    expect(rt.state()).toBe('idle')

    rt.connect()
    await waitFor(() => expect(echo.listen).toHaveBeenCalledWith('.notification.created', handler))
    echo.status('connected')
    expect(rt.state()).toBe('connected')

    stop()
    expect(echo.stopListening).toHaveBeenCalledWith('.notification.created', handler)
    expect(echo.leave).toHaveBeenCalledWith('user.1')

    rt.disconnect()
    expect(echo.disconnect).toHaveBeenCalled()
    expect(rt.state()).toBe('idle')
    expect(states).toEqual(['connecting', 'connected', 'idle'])
  })

  it('signs private channels through the HTTP client', async () => {
    const authorize = vi.fn().mockResolvedValue({ auth: 'sig' })
    const rt = createWebRealtime({ config, authorize })
    rt.connect()
    await waitFor(() => expect(echo.options.length).toBeGreaterThan(0))
    const options = echo.options.at(-1) as {
      channelAuthorization: {
        customHandler: (p: { socketId: string; channelName: string }, cb: unknown) => void
      }
    }
    const callback = vi.fn()
    options.channelAuthorization.customHandler(
      { socketId: '1.2', channelName: 'private-user.1' },
      callback,
    )
    await waitFor(() => expect(callback).toHaveBeenCalledWith(null, { auth: 'sig' }))
    expect(authorize).toHaveBeenCalledWith('1.2', 'private-user.1')
    rt.disconnect()
  })

  it('ignores a connection that resolves after logout', async () => {
    const rt = createWebRealtime({ config, authorize: vi.fn() })
    rt.connect()
    rt.disconnect()
    rt.listenPrivate('user.1', '.x', vi.fn())
    await new Promise((r) => setTimeout(r, 20))
    expect(echo.listen).not.toHaveBeenCalled()
    expect(rt.state()).toBe('idle')
  })

  it('reports channel subscription success and failure to the listener', async () => {
    echo.subscribedCbs.length = 0
    echo.errorCbs.length = 0
    const rt = createWebRealtime({ config, authorize: vi.fn() })
    const onStatus = vi.fn()
    const stop = rt.listenPrivate('user.1', '.x', vi.fn(), onStatus)
    rt.connect()
    await waitFor(() => expect(echo.subscribedCbs.length).toBe(1))
    echo.subscribedCbs[0]?.()
    expect(onStatus).toHaveBeenLastCalledWith('subscribed')
    echo.errorCbs[0]?.()
    expect(onStatus).toHaveBeenLastCalledWith('error')

    stop()
    echo.subscribedCbs[0]?.()
    expect(onStatus).toHaveBeenCalledTimes(2)
    rt.disconnect()
  })
})
