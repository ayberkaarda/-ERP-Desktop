import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { OutboxEntryDto } from '../../bridge/generated/OutboxEntryDto'
import { createFakeBridge, fail, flush } from '../../test/fakeBridge'
import { OutboxPage } from './OutboxPage'
import { renderSync } from './testing'
import type { HttpClient } from '@/platform/types'

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
      expect(within(row(key)).queryByRole('button', { name: 'Değişiklikten vazgeç' })).toBeNull()
    }
    for (const key of ['k-rejected', 'k-quarantined']) {
      expect(within(row(key)).getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument()
      expect(within(row(key)).getByRole('button', { name: 'Değişiklikten vazgeç' })).toBeInTheDocument()
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
    await userEvent.click(within(row('k-quarantined')).getByRole('button', { name: 'Değişiklikten vazgeç' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Değişiklikten vazgeçilsin mi?')
    expect(bridge.callsOf('outbox_discard')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Değişiklikten vazgeç' }))
    expect(bridge.callsOf('outbox_discard')).toEqual([{ command: 'outbox_discard', args: { key: 'k-quarantined' } }])
  })

  it('a cancelled confirmation discards nothing', async () => {
    const { bridge } = await page()
    await userEvent.click(within(row('k-rejected')).getByRole('button', { name: 'Değişiklikten vazgeç' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Değişikliği tut' }))
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

describe('readable outbox rows', () => {
  async function render(entries: OutboxEntryDto[], get: ReturnType<typeof vi.fn> = vi.fn(() => Promise.resolve(undefined))) {
    const bridge = createFakeBridge({
      commands: {
        realtime_status: () => ({ profile_id: 'p', state: 'idle' }),
        sync_status: () => ({}),
        outbox_list: () => entries,
      },
    })
    await renderSync(<OutboxPage />, { bridge, http: { get: get as unknown as HttpClient['get'] } })
    await screen.findByTestId('outbox-table')
    return get
  }

  it('names the record and its resource, not the raw id', async () => {
    await render([
      entry('k1', 'pending', { resource: 'parties', id: '01a1a340-3ca0-7412-8014-4f0be9113202', payload: { name: 'Çevrimdışı Cari A.Ş.' } }),
    ])
    expect(row('k1')).toHaveTextContent('Çevrimdışı Cari A.Ş.')
    expect(row('k1')).toHaveTextContent('Cari')
    expect(row('k1')).not.toHaveTextContent('parties')
    expect(row('k1')).not.toHaveTextContent('01a1a340')
  })

  it('reads the record from this device when the draft does not name it', async () => {
    const get = vi.fn(() => Promise.resolve({ data: { number: null, party_name: 'Ankara Gıda Ltd.' } }))
    await render([entry('k1', 'pending', { op: 'update', id: 'q1', payload: { notes: 'cuma' } })], get)
    expect(await within(row('k1')).findByText('(numarasız) · Ankara Gıda Ltd.')).toBeInTheDocument()
    expect(row('k1')).toHaveTextContent('Satış teklifi')
    expect(get).toHaveBeenCalledWith('/sales-quotes/q1', expect.anything())
  })

  it('falls back to a short id only when nothing names the record', async () => {
    await render([entry('k1', 'pending', { op: 'update', id: '01a1a32e-9bbd-71a0-91cd-404d22263479', payload: { notes: 'x' } })])
    await act(flush)
    expect(within(row('k1')).getByTestId('outbox-record')).toHaveTextContent('…263479')
  })

  it('a rejected row shows the field messages and the next step', async () => {
    await render([
      entry('k1', 'rejected', {
        resource: 'parties',
        payload: { name: 'Ankara Gıda Limited' },
        last_error: 'VALIDATION_ERROR',
        rejected_fields: { tax_number: ['Bu vergi numarası zaten kayıtlı.'] },
      }),
      entry('k2', 'rejected', {
        resource: 'parties',
        op: 'update',
        id: 'p2',
        payload: { name: 'Beta' },
        last_error: 'VALIDATION_ERROR',
      }),
    ])
    const rejected = within(row('k1')).getByTestId('outbox-rejection')
    expect(rejected).toHaveTextContent('Girilen bilgiler geçerli değil.')
    expect(within(rejected).getByTestId('outbox-rejected-fields')).toHaveTextContent(
      'Vergi numarası: Bu vergi numarası zaten kayıtlı.',
    )
    expect(rejected).toHaveTextContent('vazgeçin ve kaydı doğru bilgilerle yeniden girin')
    expect(row('k1')).toHaveTextContent('Ankara Gıda Limited')
    // An update has an edit page: it leads there.
    expect(within(row('k2')).getByRole('link', { name: 'Kaydı aç' })).toHaveAttribute('href', '/parties/p2/edit')
  })

  it('the discard dialog has no two buttons with the same name', async () => {
    await render([entry('k1', 'rejected', { last_error: 'VALIDATION_ERROR' })])
    await userEvent.click(within(row('k1')).getByRole('button', { name: 'Değişiklikten vazgeç' }))
    const dialog = await screen.findByRole('alertdialog')
    const names = within(dialog).getAllByRole('button').map((button) => button.textContent)
    expect(names).toEqual(expect.arrayContaining(['Değişikliği tut', 'Değişiklikten vazgeç']))
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain('Vazgeç')
  })
})
