import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { platform, type SubscriptionStatus } from '@/platform'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { NOTIFICATION_EVENT } from '../useNotifications'
import { NotificationBell } from './NotificationBell'

function renderBell() {
  return renderRoutes([{ path: '/', element: <NotificationBell /> }], '/')
}

describe('NotificationBell', () => {
  it('shows the unread count, marks one and then all as read', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderBell()

    const bell = await screen.findByRole('button', { name: 'Bildirimler, 1 okunmamış' })
    await user.click(bell)
    const list = await screen.findByRole('list', { name: 'Bildirimler' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)

    db.notifications.push({
      id: 'n3',
      title: 'Stok uyarısı',
      read_at: null,
      created_at: '2026-10-21T08:30:00Z',
    })
    await user.click(screen.getByRole('button', { name: /Onay bekleyen fatura/ }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.method === 'PATCH' && c.path.includes('/n1/read'))).toBe(true),
    )
  })

  it('marks everything read', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderBell()
    await user.click(await screen.findByRole('button', { name: 'Bildirimler, 1 okunmamış' }))
    await user.click(await screen.findByRole('button', { name: 'Tümünü okundu say' }))
    expect(await screen.findByRole('button', { name: 'Bildirimler' })).toBeInTheDocument()
    expect(db.calls.some((c) => c.path === '/api/v1/notifications/read-all')).toBe(true)
  })

  it('subscribes to user.{id} and prepends pushed notifications', async () => {
    const db = setupFea()
    signIn(db)
    let push: ((payload: unknown) => void) | null = null
    const stop = vi.fn()
    const listen = vi.spyOn(platform.realtime, 'listenPrivate').mockImplementation((_c, _e, h) => {
      push = h
      return stop
    })
    const info = vi.spyOn(platform.notify, 'info').mockImplementation(() => undefined)
    const { unmount } = renderBell()

    await screen.findByRole('button', { name: 'Bildirimler, 1 okunmamış' })
    expect(listen).toHaveBeenCalledWith(
      `user.${db.user.id}`,
      NOTIFICATION_EVENT,
      expect.any(Function),
      expect.any(Function),
    )

    db.notifications.unshift({
      id: 'n9',
      title: 'Yeni onay talebi',
      read_at: null,
      created_at: '2026-10-21T09:10:00Z',
    })
    act(() => push?.({ id: 'n9', title: 'Yeni onay talebi' }))
    expect(
      await screen.findByRole('button', { name: 'Bildirimler, 2 okunmamış' }),
    ).toBeInTheDocument()
    expect(info).toHaveBeenCalledWith('Yeni onay talebi', {})

    unmount()
    expect(stop).toHaveBeenCalled()
    listen.mockRestore()
    info.mockRestore()
  })

  it('degrades to a polling hint when realtime is off', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderBell()
    await user.click(await screen.findByRole('button', { name: 'Bildirimler, 1 okunmamış' }))
    expect(await screen.findByText(/Canlı bağlantı yok/)).toBeInTheDocument()
  })

  it('keeps polling until the private channel subscription succeeds', async () => {
    const db = setupFea()
    signIn(db)
    let report: ((s: SubscriptionStatus) => void) | undefined
    const listen = vi
      .spyOn(platform.realtime, 'listenPrivate')
      .mockImplementation((_c, _e, _h, onStatus) => {
        report = onStatus
        return () => undefined
      })
    const state = vi.spyOn(platform.realtime, 'state').mockReturnValue('connected')
    const user = userEvent.setup()
    renderBell()
    await user.click(await screen.findByRole('button', { name: 'Bildirimler, 1 okunmamış' }))
    // Socket is up but the channel is not authorized yet: still polling.
    expect(await screen.findByText(/Canlı bağlantı yok/)).toBeInTheDocument()

    act(() => report?.('subscribed'))
    await waitFor(() => expect(screen.queryByText(/Canlı bağlantı yok/)).not.toBeInTheDocument())

    act(() => report?.('error'))
    expect(await screen.findByText(/Canlı bağlantı yok/)).toBeInTheDocument()
    listen.mockRestore()
    state.mockRestore()
  })
})
