import { act, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { syncExtensions, useDesktopDraftRows } from '.'
import { fakeOfflineMeta, renderSync } from './testing'
import { appExtensions } from '@/app/extensions'
import { DataTable, DEFAULT_LIST_QUERY, type DataTableColumn } from '@/components/shared/data-table'
import commonTr from '@/lib/i18n/locales/common/tr.json'

interface Party {
  id: string
  name: string
}

const columns: DataTableColumn<Party>[] = [{ accessorKey: 'name', header: 'Ad', meta: { label: 'Ad' } }]
const rows: Party[] = [
  { id: 'p-1', name: 'Acme' },
  { id: 'p-2', name: 'Yeni Cari' },
]

function Parties() {
  return (
    <DataTable<Party>
      label="Cariler"
      columns={columns}
      data={rows}
      total={rows.length}
      query={DEFAULT_LIST_QUERY}
      onQueryChange={() => undefined}
      getRowId={(r) => r.id}
    />
  )
}

describe('draft rows on the web list table', () => {
  it('fills the web draft-rows slot', () => {
    expect(syncExtensions.useDraftRows).toBe(useDesktopDraftRows)
    expect(appExtensions.useDraftRows).toBe(useDesktopDraftRows)
  })

  it('marks the rows a local list answer names, until the server answers', async () => {
    const meta = fakeOfflineMeta()
    const { i18n } = await renderSync(<Parties />, { offlineMeta: meta.value, path: '/parties' })
    i18n.addResourceBundle('tr', 'common', commonTr, true, true)
    expect(screen.queryByTestId('row-draft')).toBeNull()

    act(() => {
      meta.record('/parties', { stale: false, partial: false, pending: true, draft_ids: ['p-2'] })
    })
    const marked = screen.getByText('Yeni Cari').closest('tr')
    if (!marked) throw new Error('no row')
    expect(marked).toHaveAttribute('data-draft', 'true')
    expect(within(marked).getByTestId('row-draft')).toHaveTextContent('Gönderilmedi')
    expect(screen.getAllByTestId('row-draft')).toHaveLength(1)

    act(() => {
      meta.record('/parties', undefined)
    })
    expect(screen.queryByTestId('row-draft')).toBeNull()
  })

  it('marks nothing without an offline meta store', async () => {
    await renderSync(<Parties />, { offlineMeta: null })
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.queryByTestId('row-draft')).toBeNull()
  })
})
