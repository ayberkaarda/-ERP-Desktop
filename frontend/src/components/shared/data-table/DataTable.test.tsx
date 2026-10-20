import { createColumnHelper } from '@tanstack/react-table'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DataTable, type DataTableProps } from './DataTable'
import { DEFAULT_LIST_QUERY, type ListQueryState } from './listQuery'

interface Row {
  id: string
  name: string
  amount: string
}

const makeRows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Kayıt ${i}`, amount: `${i}.00` }))

const col = createColumnHelper<Row>()
const columns = [
  col.accessor('name', { header: 'Ad', enableSorting: true, meta: { label: 'Ad' } }),
  col.accessor('amount', { header: 'Tutar', meta: { label: 'Tutar', align: 'right' } }),
]

type HarnessProps = Partial<DataTableProps<Row>> & { onQuery?: (q: ListQueryState) => void }

function Harness({ onQuery, data = makeRows(3), ...props }: HarnessProps) {
  const [query, setQuery] = useState<ListQueryState>(DEFAULT_LIST_QUERY)
  return (
    <DataTable<Row>
      label="Kayıtlar"
      columns={columns}
      data={data}
      total={data.length}
      query={query}
      onQueryChange={(next) => {
        onQuery?.(next)
        setQuery(next)
      }}
      getRowId={(r) => r.id}
      {...props}
    />
  )
}

const bodyRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('tbody tr[data-row-index]'))

describe('DataTable', () => {
  afterEach(() => localStorage.clear())

  it('drives server-side sort through the ListQuery state', async () => {
    const user = userEvent.setup()
    const onQuery = vi.fn()
    render(<Harness onQuery={onQuery} />)
    const header = screen.getByRole('columnheader', { name: /Ad/ })
    expect(header).toHaveAttribute('aria-sort', 'none')

    await user.click(within(header).getByRole('button'))
    expect(onQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: [{ id: 'name', desc: false }], page: 1 }),
    )
    expect(header).toHaveAttribute('aria-sort', 'ascending')

    await user.click(within(header).getByRole('button'))
    expect(onQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: [{ id: 'name', desc: true }] }),
    )
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Tutar' })).not.toHaveAttribute('aria-sort')
  })

  it('pages with the footer controls', async () => {
    const user = userEvent.setup()
    const onQuery = vi.fn()
    render(<Harness onQuery={onQuery} total={60} />)
    expect(screen.getByText('1–25 / 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Önceki sayfa' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Sonraki sayfa' }))
    expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    await user.click(screen.getByRole('button', { name: 'Son sayfa' }))
    expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }))
    expect(screen.getByText('51–60 / 60')).toBeInTheDocument()
  })

  it('debounces search into q and resets to page 1', async () => {
    const user = userEvent.setup()
    const onQuery = vi.fn()
    render(<Harness onQuery={onQuery} />)
    await user.type(screen.getByRole('searchbox', { name: 'Listede ara' }), 'anadolu')
    await waitFor(() =>
      expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'anadolu', page: 1 })),
    )
    expect(onQuery).toHaveBeenCalledTimes(1)
  })

  it('moves between rows with the keyboard, activates and selects', async () => {
    const user = userEvent.setup()
    const onActivate = vi.fn()
    const { container } = render(<Harness selectable onRowActivate={onActivate} />)
    const rows = bodyRows(container)
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1])

    act(() => rows[0]?.focus())
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(rows[1])
    expect(rows[1]).toHaveAttribute('tabindex', '0')
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(rows[2])
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(rows[0])
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(rows[0])

    await user.keyboard('{Enter}')
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'r0' }))

    await user.keyboard(' ')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    const bar = screen.getByRole('region', { name: 'Toplu işlemler' })
    expect(within(bar).getByText('1 kayıt seçildi')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Toplu işlemler' })).not.toBeInTheDocument()
  })

  it('passes selected ids to bulk actions and selects a whole page', async () => {
    const user = userEvent.setup()
    const onBulk = vi.fn()
    render(
      <Harness
        selectable
        bulkActions={({ selectedIds, clear }) => (
          <button
            type="button"
            onClick={() => {
              onBulk(selectedIds)
              clear()
            }}
          >
            Sil
          </button>
        )}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Sayfadaki tüm satırları seç' }))
    expect(screen.getByText('3 kayıt seçildi')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sil' }))
    expect(onBulk).toHaveBeenCalledWith(['r0', 'r1', 'r2'])
    expect(screen.queryByText(/kayıt seçildi/)).not.toBeInTheDocument()
  })

  it('shows loading, empty and error states', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender, container } = render(<Harness data={[]} loading />)
    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Kayıtlar yükleniyor…')
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]').length).toBeGreaterThan(0)

    rerender(<Harness data={[]} />)
    expect(screen.getByText('Kayıt bulunamadı')).toBeInTheDocument()

    rerender(<Harness data={[]} error onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Liste yüklenemedi')
    await user.click(within(alert).getByRole('button', { name: 'Tekrar dene' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('virtualizes large pages and keeps aria row indexes', async () => {
    // jsdom has no layout; give elements a viewport so the virtualizer has a window to fill.
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    const { container } = render(<Harness data={makeRows(100)} total={250} />)
    await waitFor(() => expect(bodyRows(container).length).toBeGreaterThan(0))
    height.mockRestore()
    width.mockRestore()
    const rendered = bodyRows(container)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(100)
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '251')
    expect(rendered[0]).toHaveAttribute('aria-rowindex', '2')
  })

  it('restores column visibility from the saved view', () => {
    localStorage.setItem(
      'keystone.view.test.rows',
      JSON.stringify({ columnVisibility: { amount: false }, columnSizing: {}, density: 'compact' }),
    )
    render(<Harness viewKey="test.rows" />)
    expect(screen.queryByRole('columnheader', { name: 'Tutar' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Ad/ })).toBeInTheDocument()
  })
})
