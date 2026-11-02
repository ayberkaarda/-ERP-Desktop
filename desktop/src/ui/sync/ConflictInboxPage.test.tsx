import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ConflictDto } from '../../bridge/generated/ConflictDto'
import { fixtureConflict, fixtureConflicts, updateConflict } from '../../test/conflictFixtures'
import { createFakeBridge, fail, flush } from '../../test/fakeBridge'
import { ConflictInboxPage } from './ConflictInboxPage'
import { renderSync } from './testing'
import type { HttpClient } from '@/platform/types'
import { useCompanyStore } from '@/stores/company'

const ALL_CHOICES = ['keep_mine', 'take_server', 'merge', 'save_as_new_draft', 'discard', 'use_existing']

async function inbox(conflicts: ConflictDto[], resolution = 'queued') {
  const bridge = createFakeBridge({
    commands: {
      realtime_status: () => ({ profile_id: 'p', state: 'idle' }),
      sync_status: () => ({}),
      conflicts_list: () => conflicts,
      conflicts_resolve: () => ({ action: resolution }),
    },
  })
  const get = vi.fn((url: string) =>
    Promise.resolve({ data: { id: url.split('/').pop(), name: 'Anadolu Yapı Market' } }),
  )
  const harness = await renderSync(<ConflictInboxPage />, {
    bridge,
    http: { get: get as unknown as HttpClient['get'] },
    path: '/sync/conflicts',
  })
  const first = conflicts[0]
  if (first) await screen.findByTestId(`conflict-${first.idempotency_key}`)
  else await screen.findByText('Açık çakışma yok.')
  return { bridge, get, ...harness }
}

const card = (conflict: ConflictDto) => screen.getByTestId(`conflict-${conflict.idempotency_key}`)

const shownChoices = (conflict: ConflictDto) =>
  ALL_CHOICES.filter((choice) => within(card(conflict)).queryByTestId(`conflict-choice-${choice}`) !== null)

function decision(bridge: Awaited<ReturnType<typeof inbox>>['bridge']) {
  return bridge.callsOf('conflicts_resolve').map((c) => c.args?.decision)
}

describe('conflict inbox from the contract fixtures', () => {
  const fixtures = fixtureConflicts()

  it.each(fixtures.map((f) => [`${f.file} ${f.dto.code}`, f.dto] as const))(
    '%s shows only choices the server offered',
    async (_name, dto) => {
      await inbox([dto])
      const shown = shownChoices(dto)
      expect(shown.length).toBeGreaterThan(0)
      for (const choice of shown) expect(dto.choices).toContain(choice)
    },
  )

  it('a locked document offers a new draft or discarding, never keep_mine', async () => {
    const locked = fixtureConflict('DOCUMENT_LOCKED')
    const offered = { ...locked, choices: ['keep_mine', ...locked.choices] }
    await inbox([offered])
    expect(shownChoices(offered)).toEqual(['save_as_new_draft', 'discard'])
    expect(card(offered)).toHaveTextContent('Belge sunucuda artık taslak değil')
    expect(card(offered)).toHaveTextContent('Sipariş onaylandığı için değiştirilemez.')
  })

  it('save_as_new_draft resolves with the choice alone', async () => {
    const locked = fixtureConflict('DOCUMENT_LOCKED')
    const { bridge, notify } = await inbox([locked])
    await userEvent.click(within(card(locked)).getByTestId('conflict-choice-save_as_new_draft'))
    expect(decision(bridge)).toEqual([{ idempotency_key: locked.idempotency_key, choice: 'save_as_new_draft' }])
    expect(notify.success).toHaveBeenCalledWith('Karar kaydedildi; değişiklik sunucuya gönderilecek.')
  })

  it('a duplicate names its candidates and uses the chosen one', async () => {
    const duplicate = fixtureConflict('DUPLICATE_RECORD')
    const { bridge, get, notify } = await inbox([duplicate], 'use_existing')
    const candidate = duplicate.candidates?.[0] ?? ''
    expect(await within(card(duplicate)).findByText('Anadolu Yapı Market')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith(`/parties/${candidate}`, expect.anything())
    await userEvent.click(within(card(duplicate)).getByTestId('conflict-choice-use_existing'))
    expect(decision(bridge)).toEqual([
      { idempotency_key: duplicate.idempotency_key, choice: 'use_existing', candidate },
    ])
    expect(notify.success).toHaveBeenCalledWith('Mevcut kayıt kullanılıyor.')
  })

  it('a deleted record shows no merge and no field choice', async () => {
    const deleted = fixtureConflict('VERSION_CONFLICT')
    await inbox([{ ...deleted, choices: [...deleted.choices, 'merge'] }])
    expect(shownChoices(deleted)).toEqual(['keep_mine', 'take_server'])
    expect(within(card(deleted)).queryByRole('radio')).toBeNull()
  })
})

describe('version conflict of an update', () => {
  it('compares my value and the server value of each conflicting field', async () => {
    const conflict = updateConflict()
    await inbox([conflict])
    const notes = within(card(conflict)).getByTestId('conflict-field-notes')
    expect(notes).toHaveTextContent('yerel not')
    expect(notes).toHaveTextContent('sunucu notu')
    expect(within(card(conflict)).getByTestId('conflict-field-valid_until')).toHaveTextContent('2026-12-01')
    expect(shownChoices(conflict)).toEqual(['keep_mine', 'take_server', 'merge'])
  })

  it('merge sends only the fields I kept, with my values', async () => {
    const conflict = updateConflict()
    const { bridge } = await inbox([conflict])
    const field = within(card(conflict)).getByTestId('conflict-field-valid_until')
    await userEvent.click(within(field).getByRole('radio', { name: 'Sunucununki' }))
    await userEvent.click(within(card(conflict)).getByTestId('conflict-choice-merge'))
    expect(decision(bridge)).toEqual([
      {
        idempotency_key: conflict.idempotency_key,
        choice: 'merge',
        merged: { notes: 'yerel not', internal_notes: 'iç not' },
      },
    ])
  })

  it('a merge with nothing left to send cannot be chosen', async () => {
    const conflict = updateConflict({ local_payload: { notes: 'yerel not' }, conflicting_fields: ['notes'] })
    await inbox([conflict])
    await userEvent.click(within(card(conflict)).getByRole('radio', { name: 'Sunucununki' }))
    expect(within(card(conflict)).getByTestId('conflict-choice-merge')).toBeDisabled()
    expect(card(conflict)).toHaveTextContent('Birleştirmede gönderilecek alan kalmadı')
  })

  it('take_server resolves, invalidates the resource and reads the status again', async () => {
    useCompanyStore.setState({ activeCompanyId: 'c-1' })
    const conflict = updateConflict()
    const { bridge, client, notify } = await inbox([conflict], 'take_server')
    client.setQueryData(['sales', 'c-1', 'quotes'], [])
    client.setQueryData(['parties', 'c-1'], [])
    const statusReads = bridge.callsOf('sync_status').length
    await userEvent.click(within(card(conflict)).getByTestId('conflict-choice-take_server'))
    await act(flush)
    expect(decision(bridge)).toEqual([{ idempotency_key: conflict.idempotency_key, choice: 'take_server' }])
    expect(notify.success).toHaveBeenCalledWith('Sunucudaki kayıt alındı.')
    expect(client.getQueryState(['sales', 'c-1', 'quotes'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['parties', 'c-1'])?.isInvalidated).toBe(false)
    expect(bridge.callsOf('sync_status').length).toBeGreaterThan(statusReads)
  })

  it('a refused resolution is reported', async () => {
    const conflict = updateConflict()
    const { bridge, notify } = await inbox([conflict])
    bridge.handle({ conflicts_resolve: () => fail('INVALID_REQUEST') })
    await userEvent.click(within(card(conflict)).getByTestId('conflict-choice-keep_mine'))
    expect(notify.error).toHaveBeenCalledWith('Çözülemedi: INVALID_REQUEST')
    expect(notify.success).not.toHaveBeenCalled()
  })
})

describe('conflict inbox list', () => {
  it('an empty inbox says so', async () => {
    await inbox([])
    expect(screen.getByText('Açık çakışma yok.')).toBeInTheDocument()
  })
})
