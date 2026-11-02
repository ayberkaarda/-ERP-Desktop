import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StatusDto } from '../../bridge/generated/StatusDto'
import { createFakeBridge, fail, flush } from '../../test/fakeBridge'
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
      realtime_status: () => ({ profile_id: P1, state: 'connected' }),
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
    const { bridge } = await header(status({ state: 'failed', error_code: 'NETWORK_ERROR' }), {
      text: { errors: { NETWORK_ERROR: 'Sunucuya ulaşılamadı' } },
    })
    await userEvent.click(screen.getByTestId('sync-status'))
    const details = await screen.findByTestId('sync-status-details')
    expect(within(details).getByTestId('sync-last-error')).toHaveTextContent('Son hata: Sunucuya ulaşılamadı')
    expect(details).toHaveTextContent('Canlı bağlantı açık')
    await userEvent.click(within(details).getByRole('button', { name: 'Şimdi eşitle' }))
    expect(bridge.callsOf('sync_now')).toHaveLength(1)
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
    expect(notify.error).toHaveBeenCalledWith('Eşitleme başlatılamadı: ENGINE_UNAVAILABLE')
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
  it('a refused server-only action gets the translated reason', async () => {
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
