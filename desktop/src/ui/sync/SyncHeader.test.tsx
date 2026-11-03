import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StatusDto } from '../../bridge/generated/StatusDto'
import { createFakeBridge, deferred, fail, flush } from '../../test/fakeBridge'
import { FreshnessStrip } from './FreshnessStrip'
import { SyncHeader } from './SyncHeader'
import { fakeOfflineMeta, renderSync } from './testing'
import { ApiError } from '@/platform/types'
import { useCompanyStore } from '@/stores/company'

const P1 = 'profile-1'

function status(overrides: Partial<StatusDto> = {}): StatusDto {
  return {
    state: 'idle',
    error_code: null,
    pending: 0,
    conflicts: 0,
    rejected: 0,
    quarantined: 0,
    failures: 0,
    retry_after: null,
    manifest_mismatch: false,
    ...overrides,
  }
}

function bridgeWith(initial: StatusDto) {
  return createFakeBridge({
    commands: {
      realtime_status: () => ({ profile_id: P1, state: 'connected', subscribed: ['private-user.u1'] }),
      sync_status: () => initial,
      sync_now: () => undefined,
    },
  })
}

async function header(initial: StatusDto, options: Parameters<typeof renderSync>[1] = {}) {
  const bridge = bridgeWith(initial)
  const harness = await renderSync(
    <header>
      <SyncHeader />
    </header>,
    { bridge, ...options },
  )
  await act(flush)
  return { bridge, ...harness }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('sync status badge', () => {
  it.each([
    ['idle', 'Eşitlendi'],
    ['syncing', 'Eşitleniyor'],
    ['offline', 'Çevrimdışı'],
    ['auth_required', 'Oturum gerekli'],
    ['failed', 'Eşitleme hatası'],
    ['something_new', 'Eşitleme durumu bilinmiyor'],
  ])('state %s reads "%s"', async (state, label) => {
    await header(status({ state }))
    const badge = screen.getByRole('button', { name: `Eşitleme durumu: ${label}` })
    expect(badge).toHaveTextContent(label)
    expect(badge).toHaveAttribute('data-state-name', state)
  })

  it('shows nothing while the profile has no engine', async () => {
    const bridge = createFakeBridge({
      commands: {
        realtime_status: () => ({ profile_id: P1, state: 'idle' }),
        sync_status: () => fail('ENGINE_UNAVAILABLE'),
      },
    })
    await renderSync(<SyncHeader />, { bridge })
    await act(flush)
    expect(screen.queryByTestId('sync-status')).toBeNull()
  })

  it('without a bridge from the platform no badge is shown', async () => {
    await renderSync(<SyncHeader />, { bridge: null })
    expect(screen.queryByTestId('sync-status')).toBeNull()
  })

  it('tells the last error by its translated code, the realtime state, and syncs now', async () => {
    const { bridge } = await header(status({ state: 'failed', error_code: 'NETWORK_ERROR' }))
    await userEvent.click(screen.getByTestId('sync-status'))
    const details = await screen.findByTestId('sync-status-details')
    expect(within(details).getByTestId('sync-last-error')).toHaveTextContent('Son hata: Sunucuya ulaşılamıyor.')
    expect(details).toHaveTextContent('Canlı bağlantı açık')
    await userEvent.click(within(details).getByRole('button', { name: 'Şimdi eşitle' }))
    expect(bridge.callsOf('sync_now')).toHaveLength(1)
  })

  it('a refused certificate is told apart from a server that cannot be reached', async () => {
    await header(status({ state: 'failed', error_code: 'TLS_CERTIFICATE_INVALID' }))
    await userEvent.click(screen.getByTestId('sync-status'))
    const shown = await screen.findByTestId('sync-last-error')
    expect(shown).toHaveTextContent('Son hata: Sunucunun sertifikasına güvenilmiyor; bağlantı kurulmadı.')
    expect(shown).not.toHaveTextContent('Sunucuya ulaşılamıyor.')
  })

  it('an error code without a translation is shown as the code', async () => {
    await header(status({ state: 'failed', error_code: 'SOMETHING_NEW' }))
    await userEvent.click(screen.getByTestId('sync-status'))
    expect(await screen.findByTestId('sync-last-error')).toHaveTextContent('Son hata: SOMETHING_NEW')
  })

  it('a refused sync now is reported', async () => {
    const { bridge, notify } = await header(status())
    bridge.handle({ sync_now: () => fail('ENGINE_UNAVAILABLE') })
    await userEvent.click(screen.getByTestId('sync-status'))
    await userEvent.click(await screen.findByTestId('sync-now'))
    expect(notify.error).toHaveBeenCalledWith('Eşitleme başlatılamadı: Eşitleme şu anda çalışmıyor.')
  })

  it('counts the Retry-After seconds down', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    await header(status({ state: 'failed', retry_after: 3 }))
    expect(screen.getByTestId('sync-retry')).toHaveTextContent('3 sn sonra yeniden denenecek')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('sync-retry')).toHaveTextContent('2 sn sonra')
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.queryByTestId('sync-retry')).toBeNull()
  })

  it('follows status events of the active profile only', async () => {
    const { bridge } = await header(status())
    act(() => {
      bridge.emitEngine({ type: 'status', profile_id: 'someone-else', status: status({ pending: 5 }) })
    })
    await act(flush)
    expect(screen.queryByTestId('sync-pending')).toBeNull()
    act(() => {
      bridge.emitEngine({ type: 'status', profile_id: P1, status: status({ state: 'syncing', pending: 5 }) })
    })
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Eşitleniyor')
    expect(screen.getByTestId('sync-pending')).toHaveTextContent('Bekleyen: 5')
  })
})

describe('work badges', () => {
  it('the pending badge opens the outbox', async () => {
    await header(status({ pending: 4 }))
    await userEvent.click(screen.getByTestId('sync-pending'))
    expect(screen.getByTestId('location')).toHaveTextContent('/sync/outbox')
  })

  it('the conflict badge opens the conflict inbox', async () => {
    await header(status({ conflicts: 2 }))
    expect(screen.getByTestId('sync-conflicts')).toHaveTextContent('Çakışma: 2')
    await userEvent.click(screen.getByTestId('sync-conflicts'))
    expect(screen.getByTestId('location')).toHaveTextContent('/sync/conflicts')
  })

  it('counts rejected and quarantined entries', async () => {
    await header(status({ rejected: 1, quarantined: 2 }))
    expect(screen.getByTestId('sync-problems')).toHaveTextContent('Reddedilen: 1, karantina: 2')
    await userEvent.click(screen.getByTestId('sync-problems'))
    expect(screen.getByTestId('location')).toHaveTextContent('/sync/outbox')
  })

  it('shows no work badge without work', async () => {
    await header(status())
    for (const id of ['sync-pending', 'sync-conflicts', 'sync-problems', 'sync-manifest-mismatch']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
  })

  it('warns that offline writing is closed on a manifest mismatch', async () => {
    await header(status({ manifest_mismatch: true }))
    expect(screen.getByRole('alert')).toHaveTextContent('Çevrimdışı yazma kapalı')
    expect(screen.getByRole('alert')).toHaveTextContent('uygulamayı güncelleyin')
  })
})

describe('resource changes', () => {
  it('invalidate the changed resource of the active company only', async () => {
    useCompanyStore.setState({ activeCompanyId: 'c-1' })
    const { bridge, client } = await header(status())
    client.setQueryData(['parties', 'c-1'], [])
    client.setQueryData(['sales', 'c-1', 'quotes'], [])
    act(() => {
      bridge.emitEngine({ type: 'resources_changed', profile_id: P1, resources: ['parties'], all: false })
    })
    await act(flush)
    expect(client.getQueryState(['parties', 'c-1'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['sales', 'c-1', 'quotes'])?.isInvalidated).toBe(false)
  })

  it('all: true invalidates everything', async () => {
    useCompanyStore.setState({ activeCompanyId: 'c-1' })
    const { bridge, client } = await header(status())
    client.setQueryData(['sales', 'c-1', 'quotes'], [])
    act(() => {
      bridge.emitEngine({ type: 'resources_changed', profile_id: P1, resources: [], all: true })
    })
    await act(flush)
    expect(client.getQueryState(['sales', 'c-1', 'quotes'])?.isInvalidated).toBe(true)
  })
})

describe('offline refusal toast', () => {
  it('a refused route gets the text of its online-only action', async () => {
    const { client, notify } = await header(status())
    const refused = new ApiError(503, 'OFFLINE_UNAVAILABLE', 'only online', {}, {
      method: 'POST',
      path: '/fiscal-years/0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20/close',
    })
    await act(() =>
      client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.reject(refused) })
        .execute(undefined)
        .catch(() => undefined),
    )
    expect(notify.warning).toHaveBeenCalledWith('Dönem ve mali yıl kapanışı çevrimiçi yapılır.')
  })

  it('a refusal without a route gets the general reason', async () => {
    const { client, notify } = await header(status())
    await act(() =>
      client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.reject(new ApiError(503, 'OFFLINE_UNAVAILABLE', 'only online')) })
        .execute(undefined)
        .catch(() => undefined),
    )
    expect(notify.warning).toHaveBeenCalledWith(
      'Bu işlem çevrimdışıyken yapılamaz; bağlantı gelince yeniden deneyin.',
    )
  })
})

describe('freshness strip', () => {
  async function strip() {
    const meta = fakeOfflineMeta()
    const harness = await renderSync(
      <div>
        <header>
          <SyncHeader />
        </header>
        <main data-testid="main" />
      </div>,
      { bridge: null, offlineMeta: meta.value, path: '/parties' },
    )
    return { meta, ...harness }
  }

  it('stays hidden while answers come from the server', async () => {
    const { meta } = await strip()
    act(() => {
      meta.record('/parties', undefined)
    })
    expect(screen.queryByTestId('sync-freshness')).toBeNull()
  })

  it('sits right under the header', async () => {
    const { meta } = await strip()
    act(() => {
      meta.record('/parties', { stale: true, partial: false })
    })
    const shown = screen.getByTestId('sync-freshness')
    expect(shown.parentElement?.previousElementSibling?.tagName).toBe('HEADER')
    expect(shown.parentElement?.nextElementSibling).toBe(screen.getByTestId('main'))
  })

  it('says a stale copy may be out of date', async () => {
    const { meta } = await strip()
    act(() => {
      meta.record('/parties', { stale: true, partial: false })
    })
    expect(screen.getByTestId('sync-freshness-stale')).toHaveTextContent('Veriler eski olabilir.')
  })

  it('names the as-of time', async () => {
    const { meta } = await strip()
    act(() => {
      meta.record('/stock-balances', { stale: false, partial: false, as_of: '2026-11-02T07:30:00Z' })
    })
    expect(screen.getByTestId('sync-freshness-as-of')).toHaveTextContent('02.11.2026 10:30 itibarıyla.')
  })

  it('says the local copy is partial', async () => {
    const { meta } = await strip()
    act(() => {
      meta.record('/sales-quotes', { stale: false, partial: true })
    })
    expect(screen.getByTestId('sync-freshness-partial')).toHaveTextContent('Yerel kopya eksik.')
  })

  it('lists filters the local copy cannot apply', async () => {
    const { meta } = await strip()
    act(() => {
      meta.record('/parties', { stale: false, partial: false, unsupported_filters: ['search', 'balance'] })
    })
    expect(screen.getByTestId('sync-freshness-filters')).toHaveTextContent(
      'Bu filtreler çevrimdışında yok: balance, search',
    )
  })

  it('a new page drops the labels of the last one', async () => {
    const { meta, go } = await strip()
    act(() => {
      meta.record('/parties', { stale: true, partial: false })
    })
    expect(screen.getByTestId('sync-freshness')).toBeInTheDocument()
    act(() => {
      go('/items')
    })
    expect(screen.getByTestId('location')).toHaveTextContent('/items')
    expect(screen.queryByTestId('sync-freshness')).toBeNull()
    act(() => {
      meta.record('/items', { stale: false, partial: true })
    })
    expect(screen.getByTestId('sync-freshness-partial')).toBeInTheDocument()
    expect(screen.queryByTestId('sync-freshness-stale')).toBeNull()
  })
})

describe('status badge edges', () => {
  it('rounds the seconds left up between ticks', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    await header(status({ state: 'failed', retry_after: 3 }))
    act(() => {
      vi.setSystemTime(Date.now() + 500)
      vi.advanceTimersByTime(1000)
    })
    // 1.5 s gone: 1.5 s left reads "2", not "1"
    expect(screen.getByTestId('sync-retry')).toHaveTextContent('2 sn sonra')
  })

  it('the countdown timer is cleared on unmount', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    await header(status({ state: 'failed', retry_after: 30 }))
    expect(vi.getTimerCount()).toBe(1)
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('quarantined entries alone open the problems badge', async () => {
    await header(status({ quarantined: 2 }))
    expect(screen.getByTestId('sync-problems')).toHaveTextContent('Reddedilen: 0, karantina: 2')
  })

  it('a double click on sync now asks the shell once', async () => {
    const { bridge } = await header(status())
    const run = deferred<undefined>()
    bridge.handle({ sync_now: () => run.promise })
    await userEvent.click(screen.getByTestId('sync-status'))
    const button = await screen.findByTestId('sync-now')
    fireEvent.click(button)
    fireEvent.click(button)
    run.resolve(undefined)
    await act(flush)
    expect(bridge.callsOf('sync_now')).toHaveLength(1)
  })

  it('names the realtime state it was told', async () => {
    const bridge = createFakeBridge({
      commands: {
        realtime_status: () => ({ profile_id: P1, state: 'unavailable' }),
        sync_status: () => status(),
      },
    })
    await renderSync(<SyncHeader />, { bridge })
    await act(flush)
    await userEvent.click(screen.getByTestId('sync-status'))
    expect(await screen.findByTestId('sync-status-details')).toHaveTextContent('Canlı bağlantı kurulamadı')
  })

  it('a switch to a profile without an engine drops the badges of the last one', async () => {
    let active = P1
    const bridge = createFakeBridge({
      commands: {
        realtime_status: () => ({ profile_id: active, state: 'connected' }),
        sync_status: () => (active === P1 ? status({ pending: 3 }) : fail('ENGINE_UNAVAILABLE')),
      },
    })
    await renderSync(
      <header>
        <SyncHeader />
      </header>,
      { bridge },
    )
    await act(flush)
    expect(screen.getByTestId('sync-pending')).toHaveTextContent('Bekleyen: 3')
    active = 'profile-2'
    await act(async () => {
      bridge.emitRealtime({ type: 'state', profile_id: 'profile-2', state: 'connecting' })
      await flush()
    })
    expect(screen.queryByTestId('sync-pending')).toBeNull()
    expect(screen.queryByTestId('sync-status')).toBeNull()
  })
})

describe('freshness strip box', () => {
  it('goes away with the strip', async () => {
    const meta = fakeOfflineMeta()
    function Toggle() {
      const [on, setOn] = useState(true)
      return (
        <>
          <header>{on ? <FreshnessStrip source={meta.value} /> : null}</header>
          <button type="button" onClick={() => setOn(false)}>
            off
          </button>
        </>
      )
    }
    await renderSync(<Toggle />)
    const head = document.querySelector('header')
    expect(head?.nextElementSibling?.tagName).toBe('DIV')
    await userEvent.click(screen.getByText('off'))
    expect(head?.nextElementSibling?.tagName).toBe('BUTTON')
  })
})

describe('realtime channel in the status details', () => {
  async function details(subscribed: string[]) {
    const bridge = createFakeBridge({
      commands: {
        realtime_status: () => ({ profile_id: P1, state: 'connected', subscribed }),
        sync_status: () => status(),
      },
    })
    await renderSync(<SyncHeader />, { bridge })
    await act(flush)
    await userEvent.click(screen.getByTestId('sync-status'))
    await screen.findByTestId('sync-status-details')
    return bridge
  }

  const line = () => screen.getByTestId('sync-realtime')

  it('is live only with an accepted channel', async () => {
    await details(['private-user.u1'])
    expect(line()).toHaveTextContent('Canlı bağlantı açık')
  })

  it('a refused subscription is not called live', async () => {
    const bridge = await details([])
    expect(line()).not.toHaveTextContent('Canlı bağlantı açık')
    await act(async () => {
      bridge.emitRealtime({ type: 'subscription_failed', profile_id: P1, channel: 'private-user.u1' })
      await flush()
    })
    expect(line()).toHaveTextContent('Bağlantı açık, ancak kanal aboneliği reddedildi. Bildirimler kısa aralıklarla yoklanıyor.')
  })

  it('a socket without a channel yet says notifications are polled, then live once subscribed', async () => {
    const bridge = await details([])
    expect(line()).toHaveTextContent('Bağlantı açık, canlı kanal henüz yok')
    await act(async () => {
      bridge.emitRealtime({ type: 'subscribed', profile_id: P1, channel: 'private-user.u1' })
      await flush()
    })
    expect(line()).toHaveTextContent('Canlı bağlantı açık')
  })

  it('a new socket forgets the last channel', async () => {
    const bridge = await details(['private-user.u1'])
    await act(async () => {
      bridge.emitRealtime({ type: 'state', profile_id: P1, state: 'connecting' })
      bridge.emitRealtime({ type: 'state', profile_id: P1, state: 'connected' })
      await flush()
    })
    expect(line()).toHaveTextContent('Bağlantı açık, canlı kanal henüz yok')
  })
})
