import { act, screen, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import { platform, type RealtimeState, type SubscriptionStatus } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import type { FeaDb } from '@/test/handlers/fea'
import { server } from '@/test/msw/server'
import { notificationKeys, notificationsApi } from './api'
import { useNotifications } from './useNotifications'

function Probe() {
  const { feed, live } = useNotifications()
  return (
    <div>
      <p data-testid="unread">{feed.data?.unread ?? '-'}</p>
      <p data-testid="ids">{feed.data?.items.map((n) => n.id).join(',') ?? ''}</p>
      <p data-testid="live">{live ? 'live' : 'polling'}</p>
      <p data-testid="fetching">{feed.isFetching ? 'fetching' : 'idle'}</p>
    </div>
  )
}

/** Drives the realtime platform by hand: socket state plus each private channel's status. */
function fakeRealtime() {
  let current: RealtimeState = 'connected'
  const stateListeners = new Set<(s: RealtimeState) => void>()
  // One status reporter per listenPrivate call, in subscription order.
  const reports: ((s: SubscriptionStatus) => void)[] = []
  const stop = vi.fn()
  const listen = vi
    .spyOn(platform.realtime, 'listenPrivate')
    .mockImplementation((_c, _e, _h, onStatus) => {
      if (onStatus) reports.push(onStatus)
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
    /** Reports a status on the latest subscription, or on an earlier one by index. */
    status(s: SubscriptionStatus, index = reports.length - 1) {
      act(() => reports[index]?.(s))
    },
    restore: () => spies.forEach((s) => s.mockRestore()),
  }
}

const feedFetches = (db: FeaDb) =>
  db.calls.filter((c) => c.method === 'GET' && c.path === '/api/v1/notifications').length

/** Holds every feed response back by `ms`, then falls through to the fake backend. */
function delayFeed(ms: number) {
  server.use(
    http.get('*/api/v1/notifications', async () => {
      await delay(ms)
    }),
  )
}

/**
 * Waits until exactly `n` feed requests reached the backend and the query is idle again,
 * then gives stray fetches a chance to show up before re-checking.
 */
async function expectFetches(db: FeaDb, n: number) {
  await waitFor(() => expect(feedFetches(db)).toBe(n))
  await waitFor(() => expect(screen.getByTestId('fetching')).toHaveTextContent('idle'))
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

  it.each([0, 80])(
    'fetches again after a drop and shows the notification missed in the gap (response delay %i ms)',
    async (ms) => {
      const db = setupFea()
      if (ms) delayFeed(ms)
      signIn(db)
      renderProbe()
      await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
      rt.status('subscribed')
      await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent('live'))
      // Initial load plus the first-subscription refetch, both finished before the drop.
      await expectFetches(db, 2)
      expect(screen.getByTestId('ids').textContent.split(',')).not.toContain('missed')

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

      await expectFetches(db, 3)
      expect(screen.getByTestId('unread')).toHaveTextContent('2')
      expect(screen.getByTestId('ids').textContent.split(',')[0]).toBe('missed')
      expect(screen.getByTestId('live')).toHaveTextContent('live')
    },
  )

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

  it('reuses a background refetch that is in flight instead of cancelling and restarting it', async () => {
    const db = setupFea()
    signIn(db)
    const list = vi.spyOn(notificationsApi, 'list')
    const { queryClient } = renderProbe()
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
    await expectFetches(db, 1)
    expect(list).toHaveBeenCalledTimes(1)

    // A background refetch over loaded data (what a poll does), held in flight by a slow response.
    delayFeed(150)
    act(() => {
      void queryClient.refetchQueries({ queryKey: notificationKeys.feed(db.user.id) })
    })
    await waitFor(() => expect(screen.getByTestId('fetching')).toHaveTextContent('fetching'))
    expect(list).toHaveBeenCalledTimes(2)

    rt.status('subscribed')
    await expectFetches(db, 2)
    expect(list).toHaveBeenCalledTimes(2)
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

  it('ignores a late status from the previous user channel after the user changes', async () => {
    const db = setupFea()
    signIn(db)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
    await expectFetches(db, 1)

    act(() => {
      const user = useAuthStore.getState().user
      if (user) useAuthStore.setState({ user: { ...user, id: `${user.id}-other` } })
    })
    await waitFor(() => expect(rt.listen).toHaveBeenCalledTimes(2))
    await expectFetches(db, 2)
    expect(rt.stop).toHaveBeenCalledTimes(1)

    // The old channel reports after its cleanup: it must not mark the new user's feed live
    // (which would stop polling) nor trigger a refetch.
    rt.status('subscribed', 0)
    await expectFetches(db, 2)
    expect(screen.getByTestId('live')).toHaveTextContent('polling')

    rt.status('subscribed', 1)
    await expectFetches(db, 3)
    expect(screen.getByTestId('live')).toHaveTextContent('live')
  })

  it('makes no request after unmount', async () => {
    const db = setupFea()
    signIn(db)
    const { unmount } = renderProbe()
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
    await expectFetches(db, 1)
    unmount()
    expect(rt.stop).toHaveBeenCalled()
    rt.status('subscribed')
    await act(() => new Promise((r) => setTimeout(r, 30)))
    expect(feedFetches(db)).toBe(1)
  })

  it('does not subscribe or fetch without a signed-in user', async () => {
    const db = setupFea()
    renderProbe()
    rt.status('subscribed')
    await expectFetches(db, 0)
    expect(rt.listen).not.toHaveBeenCalled()
  })
})
