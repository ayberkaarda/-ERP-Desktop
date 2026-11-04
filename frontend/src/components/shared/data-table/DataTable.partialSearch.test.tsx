import { createColumnHelper } from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import { DataTable } from './DataTable'
import { DEFAULT_LIST_QUERY } from './listQuery'

interface Row {
  id: string
  name: string
}

const col = createColumnHelper<Row>()
const columns = [col.accessor('name', { header: 'Ad', meta: { label: 'Ad' } })]
const NOTICE = 'Çevrimdışı: sonuçlar yalnızca yerel kopyadan, eksik olabilir.'

function table(props: { partialSearch?: boolean; error?: boolean; data?: Row[] }) {
  const data = props.data ?? [{ id: 'r0', name: 'Cıvata' }]
  render(
    <DataTable<Row>
      label="Ürünler"
      columns={columns}
      data={data}
      total={data.length}
      query={{ ...DEFAULT_LIST_QUERY, q: 'cıv' }}
      onQueryChange={() => undefined}
      getRowId={(r) => r.id}
      partialSearch={props.partialSearch}
      error={props.error}
    />,
  )
}

describe('DataTable partial search', () => {
  afterEach(() => localStorage.clear())

  it('says the rows of a partial search may be incomplete, and describes the grid with it', () => {
    table({ partialSearch: true })
    const notice = screen.getByTestId('partial-search')
    expect(notice).toHaveTextContent(NOTICE)
    // Announced when it appears, without moving focus.
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('grid', { name: 'Ürünler' })).toHaveAccessibleDescription(
      expect.stringContaining(NOTICE),
    )
    expect(screen.getByRole('row', { name: /Cıvata/ })).toBeInTheDocument()
  })

  it('keeps the notice over an empty partial answer', () => {
    table({ partialSearch: true, data: [] })
    expect(screen.getByTestId('partial-search')).toHaveTextContent(NOTICE)
    expect(screen.getByText('Kayıt bulunamadı')).toBeInTheDocument()
  })

  it('shows nothing without the marker (the web never sets it)', () => {
    table({})
    expect(screen.queryByTestId('partial-search')).not.toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'Ürünler' })).not.toHaveAccessibleDescription(
      expect.stringContaining(NOTICE),
    )
  })

  it('leaves a failed load to the error state', () => {
    table({ partialSearch: true, error: true })
    expect(screen.queryByTestId('partial-search')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Liste yüklenemedi')
  })
})
