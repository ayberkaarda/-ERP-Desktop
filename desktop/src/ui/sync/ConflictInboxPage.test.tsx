import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ConflictDto } from '../../bridge/generated/ConflictDto'
import { updateConflict } from '../../test/conflictFixtures'
import { conflictDtoFixtures } from '../../wire'
import { createFakeBridge, deferred, fail, flush } from '../../test/fakeBridge'
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

  it('discards only after a confirmation that says what is lost', async () => {
    const locked = fixtureConflict('DOCUMENT_LOCKED')
    const { bridge, notify } = await inbox([locked], 'discard')
    await userEvent.click(within(card(locked)).getByTestId('conflict-choice-discard'))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Değişikliğinizden vazgeçilsin mi?')
    expect(dialog).toHaveTextContent('bu geri alınamaz')
    expect(dialog).not.toHaveTextContent('Kayıt yalnızca bu cihazda var')
    expect(bridge.callsOf('conflicts_resolve')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Değişikliğimden vazgeç' }))
    expect(decision(bridge)).toEqual([{ idempotency_key: locked.idempotency_key, choice: 'discard' }])
    expect(notify.success).toHaveBeenCalledWith('Değişiklikten vazgeçildi.')
  })

  it('a cancelled discard changes nothing', async () => {
    const locked = fixtureConflict('DOCUMENT_LOCKED')
    const { bridge } = await inbox([locked], 'discard')
    await userEvent.click(within(card(locked)).getByTestId('conflict-choice-discard'))
    const dialog = await screen.findByRole('alertdialog')
    // The web dialog's own cancel label (its namespace is not loaded here).
    await userEvent.click(within(dialog).getByRole('button', { name: 'confirm.cancel' }))
    await act(flush)
    expect(bridge.callsOf('conflicts_resolve')).toHaveLength(0)
    expect(card(locked)).toBeInTheDocument()
  })

  it('discarding a duplicate create warns that the local record goes too', async () => {
    const duplicate = fixtureConflict('DUPLICATE_RECORD')
    await inbox([{ ...duplicate, local_op: 'create' }])
    await userEvent.click(within(card(duplicate)).getByTestId('conflict-choice-discard'))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Kayıt yalnızca bu cihazda var; o da silinir.')
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
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Değişikliğinizden vazgeçilsin mi?')
    expect(decision(bridge)).toEqual([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Değişikliğimden vazgeç' }))
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

const CANDIDATE_1 = '0193b1e5-0c11-7a22-9b33-000000000001'
const CANDIDATE_2 = '0193b1e5-0c11-7a22-9b33-000000000002'

function duplicate(overrides: Partial<ConflictDto> = {}): ConflictDto {
  return updateConflict({
    idempotency_key: '0193b1f0-1111-7aaa-8bbb-0000000000d1',
    resource: 'parties',
    code: 'DUPLICATE_RECORD',
    conflicting_fields: [],
    server_data: null,
    candidates: [CANDIDATE_1, CANDIDATE_2],
    choices: ['use_existing', 'keep_mine', 'discard'],
    local_op: 'create',
    local_payload: { name: 'Anadolu' },
    ...overrides,
  })
}

async function inboxWith(
  conflicts: ConflictDto[],
  options: { get?: (url: string) => unknown; resolve?: () => unknown } = {},
) {
  let list = conflicts
  const bridge = createFakeBridge({
    commands: {
      realtime_status: () => ({ profile_id: 'p', state: 'idle' }),
      sync_status: () => ({}),
      conflicts_list: () => list,
      conflicts_resolve:
        options.resolve ??
        (() => {
          list = []
          return { action: 'queued' }
        }),
      sync_now: () => undefined,
    },
  })
  const get = vi.fn(
    options.get ??
      ((url: string) =>
        Promise.resolve({ data: { id: url.split('/').pop(), name: `Ad ${url.split('/').pop()?.slice(-1) ?? ''}` } })),
  )
  const harness = await renderSync(<ConflictInboxPage />, {
    bridge,
    http: { get: get as unknown as HttpClient['get'] },
    path: '/sync/conflicts',
  })
  const first = conflicts[0]
  if (first) await screen.findByTestId(`conflict-${first.idempotency_key}`)
  return { bridge, get, ...harness }
}

describe('conflict inbox edges', () => {
  it('use_existing sends the candidate the user picked, not the first', async () => {
    const dup = duplicate()
    const { bridge } = await inboxWith([dup])
    const second = within(card(dup)).getAllByRole('radio')[1]
    if (!second) throw new Error('no second candidate')
    await userEvent.click(second)
    await userEvent.click(within(card(dup)).getByTestId('conflict-choice-use_existing'))
    expect(decision(bridge)).toEqual([
      { idempotency_key: dup.idempotency_key, choice: 'use_existing', candidate: CANDIDATE_2 },
    ])
  })

  it('a candidate without a name is named by its number', async () => {
    const dup = duplicate({ resource: 'sales-quotes', candidates: [CANDIDATE_1] })
    await inboxWith([dup], { get: () => Promise.resolve({ data: { id: CANDIDATE_1, number: 'TKL-2026-0042' } }) })
    expect(await within(card(dup)).findByText('TKL-2026-0042')).toBeInTheDocument()
  })

  it('a candidate is read from its own resource', async () => {
    const dup = duplicate({ resource: 'items', candidates: [CANDIDATE_1] })
    const { get } = await inboxWith([dup])
    await act(flush)
    expect(get).toHaveBeenCalledWith(`/items/${CANDIDATE_1}`, expect.anything())
  })

  it('after a resolution the inbox is read again and the record goes away', async () => {
    const conflict = updateConflict()
    const { bridge } = await inboxWith([conflict])
    const before = bridge.callsOf('conflicts_list').length
    await userEvent.click(within(card(conflict)).getByTestId('conflict-choice-take_server'))
    await act(flush)
    expect(bridge.callsOf('conflicts_list').length).toBeGreaterThan(before)
    expect(await screen.findByText('Açık çakışma yok.')).toBeInTheDocument()
  })

  it('a double click resolves once', async () => {
    const conflict = updateConflict()
    const run = deferred<unknown>()
    const { bridge } = await inboxWith([conflict], { resolve: () => run.promise })
    const button = within(card(conflict)).getByTestId('conflict-choice-take_server')
    fireEvent.click(button)
    fireEvent.click(button)
    run.resolve({ action: 'queued' })
    await act(flush)
    expect(bridge.callsOf('conflicts_resolve')).toHaveLength(1)
  })

  it('a refused record whose server offers no discard is not discarded', async () => {
    const locked = updateConflict({
      idempotency_key: '0193b1f0-1111-7aaa-8bbb-0000000000e1',
      code: 'DOCUMENT_LOCKED',
      choices: ['keep_mine', 'save_as_new_draft'],
    })
    await inboxWith([locked])
    expect(within(card(locked)).getByTestId('conflict-refused')).toBeInTheDocument()
    expect(within(card(locked)).queryByTestId('conflict-choice-discard')).toBeNull()
    expect(within(card(locked)).getByRole('button', { name: 'Yeniden eşitle' })).toBeInTheDocument()
  })

  it('a status event reads the inbox again', async () => {
    const conflict = updateConflict()
    const { bridge } = await inboxWith([conflict])
    await act(flush)
    const before = bridge.callsOf('conflicts_list').length
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
    expect(bridge.callsOf('conflicts_list').length).toBe(before + 1)
  })

  it('a refused resolution changes nothing: no success, no new reads', async () => {
    const conflict = updateConflict()
    const { bridge, notify } = await inboxWith([conflict], { resolve: () => fail('INVALID_REQUEST') })
    await act(flush)
    const lists = bridge.callsOf('conflicts_list').length
    const statuses = bridge.callsOf('sync_status').length
    await userEvent.click(within(card(conflict)).getByTestId('conflict-choice-keep_mine'))
    await act(flush)
    expect(notify.error).toHaveBeenCalledTimes(1)
    expect(notify.success).not.toHaveBeenCalled()
    expect(bridge.callsOf('conflicts_list')).toHaveLength(lists)
    expect(bridge.callsOf('sync_status')).toHaveLength(statuses)
    expect(card(conflict)).toBeInTheDocument()
  })
})
