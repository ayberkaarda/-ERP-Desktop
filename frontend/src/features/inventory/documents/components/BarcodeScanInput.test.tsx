import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { BARCODE_PCS, ITEM_BOLT, UNIT_PCS } from '@/test/handlers/inventoryDocs'
import { server } from '@/test/msw/server'
import { platform } from '@/platform'
import { BARCODE_OFFLINE, lookupsApi } from '../api/client'
import { setupInvDocs } from '../testing'
import { BarcodeScanInput } from './BarcodeScanInput'

/**
 * The desktop answer for an item search offline: code and name matches from the local copy,
 * marked as a partial search (the copy holds no barcodes).
 */
function answerLocally(db: ReturnType<typeof setupInvDocs>) {
  server.use(
    http.get('*/api/v1/items', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q')
      if (!q) return undefined
      const needle = q.toLocaleLowerCase('tr')
      const rows = db.items.filter(
        (i) =>
          i.code.toLocaleLowerCase('tr').includes(needle) ||
          i.name.toLocaleLowerCase('tr').includes(needle),
      )
      return HttpResponse.json({
        data: rows,
        meta: {
          pagination: { current_page: 1, per_page: 10, total: rows.length, last_page: 1 },
          offline: { partial: false, stale: false, search_partial: true },
        },
      })
    }),
  )
}

describe('resolveBarcode', () => {
  it('finds a barcode through the server search', async () => {
    setupInvDocs()
    const hit = await lookupsApi.resolveBarcode(BARCODE_PCS)
    expect(hit).toMatchObject({ item: { id: ITEM_BOLT }, unitId: UNIT_PCS })
  })

  it('offline still resolves an exact item code', async () => {
    const db = setupInvDocs()
    answerLocally(db)
    const hit = await lookupsApi.resolveBarcode('stk-001')
    expect(hit).toMatchObject({ item: { id: ITEM_BOLT }, unitId: UNIT_PCS })
  })

  it('offline does not call a barcode unknown: the local copy has no barcodes', async () => {
    const db = setupInvDocs()
    answerLocally(db)
    await expect(lookupsApi.resolveBarcode(BARCODE_PCS)).rejects.toMatchObject({
      code: BARCODE_OFFLINE,
    })
    // Even when the text matches some item names, a partial answer is no "not found".
    await expect(lookupsApi.resolveBarcode('M8')).rejects.toMatchObject({ code: BARCODE_OFFLINE })
  })
})

describe('BarcodeScanInput offline', () => {
  afterEach(() => vi.restoreAllMocks())

  it('says barcodes are searched only when connected, not that the code is unknown', async () => {
    const db = setupInvDocs()
    answerLocally(db)
    const warning = vi.spyOn(platform.notify, 'warning').mockImplementation(() => undefined)
    const error = vi.spyOn(platform.notify, 'error').mockImplementation(() => undefined)
    const onHit = vi.fn()
    const user = userEvent.setup()
    render(<BarcodeScanInput onHit={onHit} />)
    await user.click(screen.getByLabelText('Barkod okut'))
    await user.keyboard(`${BARCODE_PCS}{Enter}`)
    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        `Çevrimdışı: ${BARCODE_PCS} yerel kopyada stok kodu olarak bulunamadı; barkodlar yalnızca bağlantı varken aranır.`,
      ),
    )
    expect(warning).not.toHaveBeenCalledWith(expect.stringContaining('bulunamadı.'))
    expect(error).not.toHaveBeenCalled()
    expect(onHit).not.toHaveBeenCalled()
  })
})
