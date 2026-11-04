import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { renderRoutes } from '@/test/handlers/feaRender'
import { ITEM_BOLT, U_PCS } from '@/test/handlers/catalog'
import { server } from '@/test/msw/server'
import { setupCatalog } from '../testing'
import type { Item } from '../types'
import { ItemCombobox } from './ItemCombobox'

function Harness({
  initial = null,
  onPick,
}: {
  initial?: string | null
  onPick: (item: Item | null) => void
}) {
  const [value, setValue] = useState<string | null>(initial)
  return (
    <ItemCombobox
      aria-label="Stok"
      value={value}
      onChange={(id, item) => {
        setValue(id)
        onPick(item)
      }}
    />
  )
}

describe('ItemCombobox', () => {
  it('searches items and shows base unit and tax code', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderRoutes([{ path: '/', element: <Harness onPick={onPick} /> }])
    const input = screen.getByRole('combobox', { name: 'Stok' })
    await user.type(input, 'cıv')
    await waitFor(() =>
      expect(
        db.calls
          .find((c) => c.path === '/items' && c.url.searchParams.get('q') === 'cıv')
          ?.url.searchParams.get('filter[is_active]'),
      ).toBe('true'),
    )
    const option = await screen.findByRole('option', { name: /STK000001 · Cıvata M8/ })
    expect(option).toHaveTextContent('Birim: ADET · Vergi kodu: tax-kdv20')
    await user.click(option)
    expect(onPick).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: ITEM_BOLT, base_unit_id: U_PCS }),
    )
    expect(input).toHaveValue('STK000001 · Cıvata M8')
  })

  it('returns the picked search record, not an older cached copy', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderRoutes([{ path: '/', element: <Harness initial={ITEM_BOLT} onPick={onPick} /> }])
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Stok' })).toHaveValue('STK000001 · Cıvata M8'),
    )
    const input = screen.getByRole('combobox', { name: 'Stok' })
    const bolt = db.items.find((i) => i.id === ITEM_BOLT)
    if (bolt) bolt.name = 'Cıvata M8 (yeni)'
    await user.clear(input)
    await user.type(input, 'yeni')
    await waitFor(() =>
      expect(
        db.calls.some((c) => c.path === '/items' && c.url.searchParams.get('q') === 'yeni'),
      ).toBe(true),
    )
    await user.click(await screen.findByRole('option', { name: /Cıvata M8 \(yeni\)/ }))
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Cıvata M8 (yeni)' }))
  })

  describe('when the search is answered from a local copy offline', () => {
    const NOTICE = 'Çevrimdışı: sonuçlar yalnızca yerel kopyadan, eksik olabilir.'

    /**
     * The desktop answer for a non-empty `q` offline: the local matches on code and name, marked
     * as a partial search (barcodes and variant SKUs are not searched there).
     */
    function answerLocally(db: ReturnType<typeof setupCatalog>, state = { partial: true }) {
      const asked: string[] = []
      server.use(
        http.get('*/api/v1/items', ({ request }) => {
          const q = new URL(request.url).searchParams.get('q')
          if (!q || !state.partial) return undefined
          asked.push(q)
          const needle = q.toLocaleLowerCase('tr')
          const rows = db.items.filter(
            (i) =>
              i.code.toLocaleLowerCase('tr').includes(needle) ||
              i.name.toLocaleLowerCase('tr').includes(needle),
          )
          return HttpResponse.json({
            data: rows,
            meta: {
              pagination: { current_page: 1, per_page: 20, total: rows.length, last_page: 1 },
              offline: {
                partial: false,
                stale: false,
                applied_filters: ['q', 'filter[is_active]'],
                search_partial: true,
              },
            },
          })
        }),
      )
      return asked
    }

    it('shows the local matches with a notice that they may be incomplete', async () => {
      const db = setupCatalog()
      const asked = answerLocally(db)
      const user = userEvent.setup()
      const onPick = vi.fn()
      renderRoutes([{ path: '/', element: <Harness onPick={onPick} /> }])
      const input = screen.getByRole('combobox', { name: 'Stok' })
      await user.type(input, 'cıv')
      const option = await screen.findByRole('option', { name: /STK000001 · Cıvata M8/ })
      expect(screen.queryByRole('option', { name: /Montaj/ })).not.toBeInTheDocument()
      expect(screen.getByRole('note')).toHaveTextContent(NOTICE)
      expect(input).toHaveAccessibleDescription(NOTICE)
      expect(screen.queryByText('Seçenekler yüklenemedi')).not.toBeInTheDocument()
      expect(asked).toContain('cıv')
      await user.click(option)
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: ITEM_BOLT }))
    })

    it('says so for an empty partial answer too: a barcode may still match on the server', async () => {
      const db = setupCatalog()
      answerLocally(db)
      const user = userEvent.setup()
      renderRoutes([{ path: '/', element: <Harness onPick={() => undefined} /> }])
      await user.type(screen.getByRole('combobox', { name: 'Stok' }), '8690000000001')
      expect(await screen.findByRole('note')).toHaveTextContent(NOTICE)
      expect(screen.queryByRole('option')).not.toBeInTheDocument()
    })

    it('drops the notice once the server answers again', async () => {
      const db = setupCatalog()
      const state = { partial: true }
      answerLocally(db, state)
      const user = userEvent.setup()
      renderRoutes([{ path: '/', element: <Harness onPick={() => undefined} /> }])
      const input = screen.getByRole('combobox', { name: 'Stok' })
      await user.type(input, 'cıv')
      expect(await screen.findByRole('note')).toHaveTextContent(NOTICE)
      state.partial = false
      await user.clear(input)
      await user.type(input, 'montaj')
      await screen.findByRole('option', { name: /Montaj hizmeti/ })
      await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument())
    })

    it('shows the load error for a refused search, without reading another list', async () => {
      const db = setupCatalog()
      server.use(
        http.get('*/api/v1/items', ({ request }) =>
          new URL(request.url).searchParams.get('q')
            ? HttpResponse.json(
                { errors: { message: 'Çevrimdışı.', code: 'OFFLINE_UNAVAILABLE' } },
                { status: 503 },
              )
            : undefined,
        ),
      )
      const user = userEvent.setup()
      renderRoutes([{ path: '/', element: <Harness onPick={() => undefined} /> }])
      await user.type(screen.getByRole('combobox', { name: 'Stok' }), 'cıv')
      expect(await screen.findByText('Seçenekler yüklenemedi')).toBeInTheDocument()
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
      // Only the empty box opening read the list: no fallback read without the text.
      const unfiltered = db.calls.filter(
        (c) => c.path === '/items' && c.method === 'GET' && !c.url.searchParams.has('q'),
      )
      expect(unfiltered.length).toBeLessThanOrEqual(1)
    })
  })

  it('searches on the server without a notice when online', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderRoutes([{ path: '/', element: <Harness onPick={() => undefined} /> }])
    await user.type(screen.getByRole('combobox', { name: 'Stok' }), 'montaj')
    await screen.findByRole('option', { name: /Montaj hizmeti/ })
    const items = db.calls.filter((c) => c.path === '/items')
    // The text goes to the server, as before; nothing is filtered in the browser.
    expect(items.at(-1)?.url.searchParams.get('q')).toBe('montaj')
    // The only read without a text is the empty box opening on the first key: no fallback read.
    expect(items.filter((c) => !c.url.searchParams.has('q'))).toHaveLength(1)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('labels a stored value from the item record', async () => {
    setupCatalog()
    renderRoutes([{ path: '/', element: <Harness initial={ITEM_BOLT} onPick={() => undefined} /> }])
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Stok' })).toHaveValue('STK000001 · Cıvata M8'),
    )
  })
})
