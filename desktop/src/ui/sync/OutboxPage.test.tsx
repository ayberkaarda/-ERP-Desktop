import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { OutboxEntryDto } from '../../bridge/generated/OutboxEntryDto'
import { createFakeBridge, fail, flush } from '../../test/fakeBridge'
import { OutboxPage } from './OutboxPage'
import { renderSync } from './testing'

function entry(key: string, state: string, overrides: Partial<OutboxEntryDto> = {}): OutboxEntryDto {
  return {
    idempotency_key: key,
    resource: 'sales-quotes',
    id: `id-${key}`,
    parent_id: null,
    op: 'create',
    action: null,
    state,
    attempts: 1,
    last_error: null,
    occurred_at: '2026-11-02T07:30:00Z',
    payload: {},
    ...overrides,
  }
}

const ENTRIES = [
  entry('k-pending', 'pending'),
  entry('k-flight', 'in_flight', { op: 'update' }),
  entry('k-conflict', 'conflict', { op: 'update' }),
  entry('k-rejected', 'rejected', { last_error: 'VALIDATION_ERROR' }),
  entry('k-quarantined', 'quarantined', { op: 'action', action: 'count', last_error: 'SYNC_DEPENDENCY_FAILED' }),
]

async function page(entries: OutboxEntryDto[] = ENTRIES) {
  const bridge = createFakeBridge({
    commands: {
      realtime_status: () => ({ profile_id: 'p', state: 'idle' }),
      sync_status: () => ({}),
      outbox_list: () => entries,
      outbox_retry: () => undefined,
      outbox_discard: () => undefined,
    },
  })
  const harness = await renderSync(<OutboxPage />, {
    bridge,
    path: '/sync/outbox',
  })
  if (entries.length > 0) await screen.findByTestId('outbox-table')
  else await screen.findByText('Bekleyen değişiklik yok.')
  return { bridge, ...harness }
}

const row = (key: string) => screen.getByTestId(`outbox-row-${key}`)

describe('outbox panel', () => {
  it('lists every entry with its state, operation and translated error', async () => {
    await page()
    expect(within(row('k-pending')).getByText('Bekliyor')).toBeInTheDocument()
    expect(within(row('k-flight')).getByText('Gönderiliyor')).toBeInTheDocument()
    expect(within(row('k-conflict')).getByText('Çakışma')).toBeInTheDocument()
    expect(within(row('k-rejected')).getByText('Reddedildi')).toBeInTheDocument()
    expect(within(row('k-rejected')).getByText('Girilen bilgiler geçerli değil.')).toBeInTheDocument()
    expect(within(row('k-quarantined')).getByText('Karantinada')).toBeInTheDocument()
    expect(within(row('k-quarantined')).getByText('Eylem · count')).toBeInTheDocument()
    expect(within(row('k-quarantined')).getByText('Bağlı olduğu önceki değişiklik gönderilemediği için bu değişiklik denenmedi.')).toBeInTheDocument()
  })

  it('says drafts get their number after the push', async () => {
    await page()
    expect(screen.getByText(/numara sunucuya gönderildikten sonra gelir/)).toBeInTheDocument()
  })

  it('offers retry and discard only for rejected and quarantined entries', async () => {
    await page()
    for (const key of ['k-pending', 'k-flight', 'k-conflict']) {
      expect(within(row(key)).queryByRole('button', { name: 'Yeniden dene' })).toBeNull()
      expect(within(row(key)).queryByRole('button', { name: 'Vazgeç' })).toBeNull()
    }
    for (const key of ['k-rejected', 'k-quarantined']) {
      expect(within(row(key)).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument()
      expect(within(row(key)).getByRole('button', { name: 'Vazgeç' })).toBeInTheDocument()
    }
  })

  it('retries an entry by its key and reads the status again', async () => {
    const { bridge, notify } = await page()
    const before = bridge.callsOf('sync_status').length
    await userEvent.click(within(row('k-rejected')).getByRole('button', { name: 'Yeniden dene' }))
    expect(bridge.callsOf('outbox_retry')).toEqual([{ command: 'outbox_retry', args: { key: 'k-rejected' } }])
    expect(notify.success).toHaveBeenCalledWith('Değişiklik yeniden gönderilecek.')
    expect(bridge.callsOf('sync_status').length).toBeGreaterThan(before)
    expect(bridge.callsOf('outbox_list').length).toBeGreaterThan(1)
  })

  it('discards only after confirmation', async () => {
    const { bridge } = await page()
    await userEvent.click(within(row('k-quarantined')).getByRole('button', { name: 'Vazgeç' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Değişiklikten vazgeçilsin mi?')
    expect(bridge.callsOf('outbox_discard')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }))
    expect(bridge.callsOf('outbox_discard')).toEqual([{ command: 'outbox_discard', args: { key: 'k-quarantined' } }])
  })

  it('a cancelled confirmation discards nothing', async () => {
    const { bridge } = await page()
    await userEvent.click(within(row('k-rejected')).getByRole('button', { name: 'Vazgeç' }))
    const dialog = await screen.findByRole('alertdialog')
    // The web dialog's own cancel label (its namespace is not loaded here).
    await userEvent.click(within(dialog).getByRole('button', { name: 'confirm.cancel' }))
    await act(flush)
    expect(bridge.callsOf('outbox_discard')).toHaveLength(0)
  })

  it('reports a refused retry', async () => {
    const { bridge, notify } = await page()
    bridge.handle({ outbox_retry: () => fail('INVALID_REQUEST') })
    await userEvent.click(within(row('k-rejected')).getByRole('button', { name: 'Yeniden dene' }))
    expect(notify.error).toHaveBeenCalledWith('İşlem yapılamadı: Bu istek masaüstü uygulamasından gönderilemez.')
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('a conflict entry leads to the conflict inbox', async () => {
    await page()
    await userEvent.click(within(row('k-conflict')).getByRole('button', { name: 'Çakışmayı çöz' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/sync/conflicts')
  })

  it('an empty outbox says so', async () => {
    await page([])
    expect(screen.getByText('Bekleyen değişiklik yok.')).toBeInTheDocument()
  })

  it('a list that cannot be read says why', async () => {
    const bridge = createFakeBridge({
      commands: {
        realtime_status: () => ({ profile_id: 'p', state: 'idle' }),
        sync_status: () => ({}),
        outbox_list: () => fail('ENGINE_UNAVAILABLE'),
      },
    })
    await renderSync(<OutboxPage />, { bridge })
    expect(await screen.findByRole('alert')).toHaveTextContent('Liste okunamadı: Eşitleme şu anda çalışmıyor.')
  })
})

describe('outbox panel edges', () => {
  it('a status event reads the outbox again', async () => {
    const bridge = createFakeBridge({
      commands: {
        realtime_status: () => ({ profile_id: 'p', state: 'connected' }),
        sync_status: () => ({}),
        outbox_list: () => [],
      },
    })
    await renderSync(<OutboxPage />, { bridge })
    await screen.findByText('Bekleyen değişiklik yok.')
    expect(bridge.callsOf('outbox_list')).toHaveLength(1)
    await act(async () => {
      bridge.emitEngine({
        type: 'status',
        profile_id: 'p',
        status: {
          state: 'idle',
          error_code: null,
          pending: 0,
          conflicts: 0,
          rejected: 0,
          quarantined: 0,
          failures: 0,
          retry_after: null,
          manifest_mismatch: false,
        },
      })
      await flush()
    })
    expect(bridge.callsOf('outbox_list')).toHaveLength(2)
  })

  it('an unknown entry state is shown as it came', async () => {
    await page([entry('k9', 'parked')])
    expect(row('k9')).toHaveTextContent('parked')
    expect(row('k9')).not.toHaveTextContent('Bekliyor')
  })
})
