import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ConflictDto } from '../../bridge/generated/ConflictDto'
import { updateConflict } from '../../test/conflictFixtures'
import { conflictDtoFixtures } from '../../wire'
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
      sync_now: () => undefined,
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

function fixtureConflict(code: string): ConflictDto {
  const found = conflictDtoFixtures().find((dto) => dto.code === code)
  if (!found) throw new Error(`no ${code} conflict in the fixtures`)
  return found
}

describe('conflict inbox from the contract fixtures', () => {
  it.each(conflictDtoFixtures().map((dto) => [dto.code, dto] as const))(
    '%s shows the choices the server offered, in table order',
    async (_code, dto) => {
      await inbox([dto])
      const shown = shownChoices(dto)
      expect(shown.length).toBeGreaterThan(0)
      expect([...shown].sort()).toEqual([...dto.choices].sort())
    },
  )

  it('a locked document offers a new draft or discarding', async () => {
    const locked = fixtureConflict('DOCUMENT_LOCKED')
    await inbox([locked])
    expect(shownChoices(locked)).toEqual(['save_as_new_draft', 'discard'])
    expect(card(locked)).toHaveTextContent('Belge sunucuda artık taslak değil')
    expect(card(locked)).toHaveTextContent('Sipariş onaylandığı için değiştirilemez.')
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

  it('a deleted record shows no field choice', async () => {
    const deleted = { ...fixtureConflict('VERSION_CONFLICT'), local_op: 'delete', local_payload: {} }
    await inbox([deleted])
    expect(shownChoices(deleted)).toEqual(['keep_mine', 'take_server'])
    expect(within(card(deleted)).queryByRole('radio')).toBeNull()
  })
})

describe('a conflict the model refuses', () => {
  it('is listed with an explanation and offers discard when the engine can do it', async () => {
    const locked = fixtureConflict('DOCUMENT_LOCKED')
    const odd = { ...locked, choices: ['keep_mine', ...locked.choices] }
    const { bridge } = await inbox([odd], 'discard')
    const shown = card(odd)
    expect(within(shown).getByTestId('conflict-refused')).toHaveTextContent('Bu çakışma bu sürümde çözülemiyor')
    expect(within(shown).getByTestId('conflict-refused')).toHaveTextContent('DOCUMENT_LOCKED: keep_mine')
    expect(shownChoices(odd)).toEqual(['discard'])
    await userEvent.click(within(shown).getByTestId('conflict-choice-discard'))
    expect(decision(bridge)).toEqual([{ idempotency_key: odd.idempotency_key, choice: 'discard' }])
  })

  it('without a discard the engine takes, it only explains and offers a new sync', async () => {
    const lost = updateConflict({ server_data: null, choices: ['keep_mine', 'take_server'] })
    const { bridge } = await inbox([lost])
    const shown = card(lost)
    expect(within(shown).getByTestId('conflict-refused')).toHaveTextContent('server_data_missing')
    expect(shown).toHaveTextContent('Yeniden eşitleyin')
    expect(shownChoices(lost)).toEqual([])
    await userEvent.click(within(shown).getByRole('button', { name: 'Yeniden eşitle' }))
    expect(bridge.callsOf('sync_now')).toHaveLength(1)
  })

  it('a discard the server offers outside the code table is not shown', async () => {
    const odd = updateConflict({ choices: ['keep_mine', 'discard'] })
    await inbox([odd])
    expect(shownChoices(odd)).toEqual([])
    expect(card(odd)).toHaveTextContent('Yeniden eşitleyin')
  })

  it('an unknown code does not break the rest of the inbox', async () => {
    const unknown = updateConflict({ idempotency_key: 'k-unknown', code: 'SOMETHING_NEW' })
    const fine = updateConflict()
    await inbox([unknown, fine])
    expect(within(card(unknown)).getByTestId('conflict-refused')).toHaveTextContent('SOMETHING_NEW')
    expect(shownChoices(fine)).toEqual(['keep_mine', 'take_server', 'merge'])
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
    expect(notify.error).toHaveBeenCalledWith('Çözülemedi: Bu istek masaüstü uygulamasından gönderilemez.')
    expect(notify.success).not.toHaveBeenCalled()
  })
})

describe('conflict inbox list', () => {
  it('an empty inbox says so', async () => {
    await inbox([])
    expect(screen.getByText('Açık çakışma yok.')).toBeInTheDocument()
  })
})
