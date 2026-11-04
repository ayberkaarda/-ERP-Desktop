import { createColumnHelper } from '@tanstack/react-table'
import { render, screen, within } from '@testing-library/react'
import { DataTable } from './DataTable'
import { DEFAULT_LIST_QUERY } from './listQuery'

// A runtime with a local copy names the rows that carry an unsent change.
const drafts = vi.hoisted(() => ({ ids: new Set<string>() }))
vi.mock('@/app/extensions', () => ({
  appExtensions: { routes: [], publicRoutes: [], useDraftRows: () => drafts.ids },
}))

interface Row {
  id: string
  name: string
}

const col = createColumnHelper<Row>()
const columns = [
  col.accessor('name', { header: 'Ad', meta: { label: 'Ad' } }),
  col.accessor('id', { header: 'Kod', meta: { label: 'Kod' } }),
]
const data: Row[] = [
  { id: 'r0', name: 'Sunucudaki kayıt' },
  { id: 'r1', name: 'Çevrimdışı kayıt' },
]

function table(selectable = false) {
  const { container } = render(
    <DataTable<Row>
      label="Kayıtlar"
      columns={columns}
      data={data}
      total={data.length}
      query={DEFAULT_LIST_QUERY}
      onQueryChange={() => undefined}
      getRowId={(r) => r.id}
      selectable={selectable}
    />,
  )
  return Array.from(container.querySelectorAll<HTMLElement>('tbody tr[data-row-index]'))
}

describe('DataTable draft rows', () => {
  afterEach(() => {
    drafts.ids = new Set()
    localStorage.clear()
  })

  it('marks the rows the runtime names, in the first data cell', () => {
    drafts.ids = new Set(['r1'])
    const [sent, unsent] = table()
    if (!sent || !unsent) throw new Error('two rows expected')
    expect(sent).not.toHaveAttribute('data-draft')
    expect(within(sent).queryByTestId('row-draft')).toBeNull()
    expect(unsent).toHaveAttribute('data-draft', 'true')
    const marker = within(unsent).getByTestId('row-draft')
    expect(marker).toHaveTextContent('Gönderilmedi')
    expect(marker).toHaveAttribute(
      'title',
      'Bu satırda bu cihazda yapılmış, sunucuya henüz gönderilmemiş bir değişiklik var.',
    )
    const firstCell = unsent.querySelector('td')
    expect(firstCell).toContainElement(marker)
    expect(firstCell).toHaveTextContent('Çevrimdışı kayıt')
    expect(screen.getAllByTestId('row-draft')).toHaveLength(1)
  })

  it('puts the marker next to the name, not in the selection cell', () => {
    drafts.ids = new Set(['r0'])
    const [row] = table(true)
    if (!row) throw new Error('a row expected')
    const [selectCell, nameCell] = Array.from(row.querySelectorAll('td'))
    expect(selectCell).not.toContainElement(screen.getByTestId('row-draft'))
    expect(nameCell).toContainElement(screen.getByTestId('row-draft'))
  })

  it('marks nothing while the runtime names no row', () => {
    const rows = table()
    expect(rows).toHaveLength(2)
    expect(screen.queryByTestId('row-draft')).toBeNull()
  })
})
