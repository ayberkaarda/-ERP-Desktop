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

  describe('when the text search is not available offline', () => {
    /** The desktop answer for a non-empty `q` offline; the unfiltered list still answers. */
    function refuseTextSearch(code = 'OFFLINE_UNAVAILABLE', status = 503) {
      const refused: string[] = []
      server.use(
        http.get('*/api/v1/items', ({ request }) => {
          const q = new URL(request.url).searchParams.get('q')
          if (!q) return undefined
          refused.push(q)
          return HttpResponse.json(
            {
              errors: { message: 'Bu istek çevrimdışıyken yanıtlanamıyor.', code },
              meta: {
                offline: {
                  partial: false,
                  stale: false,
                  unsupported_filters: ['q'],
                  online_only: [{ param: 'q', reason: 'Barkodlar ve varyant SKUları da aranır.' }],
                },
              },
            },
            { status },
          )
        }),
      )
      return refused
    }

    // Refused requests never reach the catalog recorder: these are the unfiltered reads.
    const listCalls = (db: ReturnType<typeof setupCatalog>) =>
      db.calls.filter((c) => c.path === '/items' && c.method === 'GET')

    it('searches the loaded unfiltered page by code and name, with a notice', async () => {
      const db = setupCatalog()
      const refused = refuseTextSearch()
      const user = userEvent.setup()
      const onPick = vi.fn()
      renderRoutes([{ path: '/', element: <Harness onPick={onPick} /> }])
      const input = screen.getByRole('combobox', { name: 'Stok' })
      await user.type(input, 'CIVATA')
      const option = await screen.findByRole('option', { name: /STK000001 · Cıvata M8/ })
      expect(screen.queryByRole('option', { name: /Montaj/ })).not.toBeInTheDocument()
      expect(screen.getByRole('note')).toHaveTextContent(
        'Çevrimdışı: yalnızca yüklü ürünler aranıyor; barkod ve varyant için bağlanın.',
      )
      expect(screen.queryByText('Seçenekler yüklenemedi')).not.toBeInTheDocument()
      expect(refused).toContain('CIVATA')
      // The fallback is the normal list: no text, same page size and filters.
      const [fallback] = listCalls(db)
      expect(fallback?.url.searchParams.has('q')).toBe(false)
      expect(fallback?.url.searchParams.get('per_page')).toBe('20')
      expect(fallback?.url.searchParams.get('filter[is_active]')).toBe('true')
      await user.click(option)
      expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: ITEM_BOLT }))
    })

    it('matches the item code and reuses the loaded page for the next keystrokes', async () => {
      const db = setupCatalog()
      refuseTextSearch()
      const user = userEvent.setup()
      renderRoutes([{ path: '/', element: <Harness onPick={() => undefined} /> }])
      const input = screen.getByRole('combobox', { name: 'Stok' })
      await user.type(input, 'stk')
      await screen.findByRole('option', { name: /Montaj hizmeti/ })
      expect(screen.getByRole('option', { name: /Cıvata M8/ })).toBeInTheDocument()
      await user.type(input, '000002')
      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
      expect(screen.getByRole('option', { name: /Montaj hizmeti/ })).toBeInTheDocument()
      expect(listCalls(db)).toHaveLength(1)
    })

    it('reuses the page the empty box already loaded', async () => {
      const db = setupCatalog()
      refuseTextSearch()
      const user = userEvent.setup()
      renderRoutes([{ path: '/', element: <Harness onPick={() => undefined} /> }])
      const input = screen.getByRole('combobox', { name: 'Stok' })
      await user.click(screen.getByRole('button', { name: 'Seçenekleri göster' }))
      await screen.findByRole('option', { name: /Montaj hizmeti/ })
      await user.type(input, 'montaj')
      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
      expect(screen.getByRole('option', { name: /Montaj hizmeti/ })).toBeInTheDocument()
      expect(listCalls(db)).toHaveLength(1)
    })

    it('still shows the load error for other failures', async () => {
      setupCatalog()
      refuseTextSearch('SERVER_ERROR', 500)
      const user = userEvent.setup()
      renderRoutes([{ path: '/', element: <Harness onPick={() => undefined} /> }])
      await user.type(screen.getByRole('combobox', { name: 'Stok' }), 'cıv')
      expect(await screen.findByText('Seçenekler yüklenemedi')).toBeInTheDocument()
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
    })

    it('shows the load error when the unfiltered list is refused too', async () => {
      setupCatalog()
      server.use(
        http.get('*/api/v1/items', () =>
          HttpResponse.json(
            { errors: { message: 'Çevrimdışı.', code: 'OFFLINE_UNAVAILABLE' } },
            { status: 503 },
          ),
        ),
      )
      const user = userEvent.setup()
      renderRoutes([{ path: '/', element: <Harness onPick={() => undefined} /> }])
      await user.type(screen.getByRole('combobox', { name: 'Stok' }), 'cıv')
      expect(await screen.findByText('Seçenekler yüklenemedi')).toBeInTheDocument()
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
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
    expect(items.length).toBeGreaterThan(0)
    expect(items.at(-1)?.url.searchParams.get('q')).toBe('montaj')
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
