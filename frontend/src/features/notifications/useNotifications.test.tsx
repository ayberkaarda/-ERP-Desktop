import { act, screen, waitFor } from '@testing-library/react'
import { platform, type RealtimeState, type SubscriptionStatus } from '@/platform'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import type { FeaDb } from '@/test/handlers/fea'
import { notificationsApi } from './api'
import { useNotifications } from './useNotifications'

function Probe() {
  const { feed, live } = useNotifications()
  return (
    <div>
      <p data-testid="unread">{feed.data?.unread ?? '-'}</p>
      <p data-testid="ids">{feed.data?.items.map((n) => n.id).join(',') ?? ''}</p>
      <p data-testid="live">{live ? 'live' : 'polling'}</p>
    </div>
  )
}

/** Drives the realtime platform by hand: socket state plus the private channel status. */
function fakeRealtime() {
  let current: RealtimeState = 'connected'
  const stateListeners = new Set<(s: RealtimeState) => void>()
  let report: ((s: SubscriptionStatus) => void) | undefined
  const stop = vi.fn()
  const listen = vi
    .spyOn(platform.realtime, 'listenPrivate')
    .mockImplementation((_c, _e, _h, onStatus) => {
      report = onStatus
      return stop
    })
  const spies = [
    vi.spyOn(platform.realtime, 'state').mockImplementation(() => current),
    vi.spyOn(platform.realtime, 'subscribe').mockImplementation((l) => {
      stateListeners.add(l)
      return () => stateListeners.delete(l)
    }),
    listen,
  ]
  return {
    stop,
    listen,
    setState(next: RealtimeState) {
      act(() => {
        current = next
        stateListeners.forEach((l) => l(next))
      })
    },
    status(s: SubscriptionStatus) {
      act(() => report?.(s))
    },
    restore: () => spies.forEach((s) => s.mockRestore()),
  }
}

const feedFetches = (db: FeaDb) =>
  db.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/notifications').length

/** Waits for the count, then gives stray fetches a chance to show up before re-checking. */
async function expectFetches(db: FeaDb, n: number) {
  await waitFor(() => expect(feedFetches(db)).toBe(n))
  await act(() => new Promise((r) => setTimeout(r, 30)))
  expect(feedFetches(db)).toBe(n)
}

function renderProbe() {
  return renderRoutes([{ path: '/', element: <Probe /> }], '/')
}

describe('useNotifications realtime catch-up', () => {
  let rt: ReturnType<typeof fakeRealtime>
  beforeEach(() => {
    rt = fakeRealtime()
  })
  afterEach(() => rt.restore())

  it('refetches the feed when the channel is subscribed again after a drop', async () => {
    const db = setupFea()
    signIn(db)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
    rt.status('subscribed')
    await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent('live'))
    const before = feedFetches(db)

    // Socket drops; a notification is created while no event can be delivered.
    rt.setState('connecting')
    expect(screen.getByTestId('live')).toHaveTextContent('polling')
    db.notifications.unshift({
      id: 'missed',
      title: 'Kaçırılan bildirim',
      read_at: null,
      created_at: '2026-10-21T09:30:00Z',
    })
    rt.setState('connected')
    rt.status('subscribed')

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('2'))
    expect(screen.getByTestId('ids').textContent.split(',')[0]).toBe('missed')
    expect(screen.getByTestId('live')).toHaveTextContent('live')
    await expectFetches(db, before + 1)
  })

  it('does not double fetch when the first subscription lands during the initial load', async () => {
    const db = setupFea()
    signIn(db)
    const list = vi.spyOn(notificationsApi, 'list')
    renderProbe()
    // The initial request is still in flight here: it is reused, not cancelled and restarted.
    expect(list).toHaveBeenCalledTimes(1)
    rt.status('subscribed')
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
    await expectFetches(db, 1)
    expect(list).toHaveBeenCalledTimes(1)
    list.mockRestore()
  })

  it('refetches at most once for a first subscription after the initial load', async () => {
    const db = setupFea()
    signIn(db)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
    await expectFetches(db, 1)
    rt.status('subscribed')
    await expectFetches(db, 2)
  })

  it('refetches once per transition into subscribed, not on repeated reports', async () => {
    const db = setupFea()
    signIn(db)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
    rt.status('subscribed')
    await expectFetches(db, 2)

    // A repeated "subscribed" without a drop in between is not a transition.
    rt.status('subscribed')
    await expectFetches(db, 2)

    rt.setState('connecting')
    rt.setState('connected')
    rt.status('subscribed')
    await expectFetches(db, 3)

    rt.setState('connecting')
    rt.setState('connected')
    rt.status('subscribed')
    await expectFetches(db, 4)

    // A channel error followed by a successful resubscribe also counts as a transition.
    rt.status('error')
    rt.status('subscribed')
    await expectFetches(db, 5)
  })

  it('does not refetch after unmount', async () => {
    const db = setupFea()
    signIn(db)
    const { unmount } = renderProbe()
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
    await expectFetches(db, 1)
    unmount()
    expect(rt.stop).toHaveBeenCalled()
    rt.status('subscribed')
    await expectFetches(db, 1)
  })

  it('does not subscribe or fetch without a signed-in user', async () => {
    const db = setupFea()
    renderProbe()
    rt.status('subscribed')
    await expectFetches(db, 0)
    expect(rt.listen).not.toHaveBeenCalled()
  })
})
