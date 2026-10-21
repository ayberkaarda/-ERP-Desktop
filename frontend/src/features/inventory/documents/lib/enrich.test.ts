import { QueryClient } from '@tanstack/react-query'
import { useCompanyStore } from '@/stores/company'
import { lookupsApi, type UnitRow } from '../api/client'
import { invDocsKeys } from '../api/keys'
import type { ItemRef, StockDocument } from '../types'
import { enrichDocument, resolveItems } from './enrich'

const doc = {
  id: 'd1',
  warehouse_id: 'w1',
  target_warehouse_id: null,
  lines: [{ id: 'l1', item_id: 'i1', unit_id: 'u1', location_id: null }],
} as unknown as StockDocument

const unit: UnitRow = { id: 'u1', code: 'PCS', name: 'Pieces' }
const item = { id: 'i1', code: 'STK-1', name: 'Screw', base_unit_id: 'u1' } as ItemRef

describe('document enrichment and the active company', () => {
  beforeEach(() => useCompanyStore.setState({ activeCompanyId: 'A' }))
  afterEach(() => vi.restoreAllMocks())

  it('caches nothing when the company changes while a lookup is in flight', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(lookupsApi, 'units').mockImplementation(async () => {
      useCompanyStore.setState({ activeCompanyId: 'B' })
      return [unit]
    })
    vi.spyOn(lookupsApi, 'itemsByIds').mockResolvedValue([item])

    const out = await enrichDocument(qc, doc, 'A')

    expect(out.lines[0]?.unit_code ?? null).toBeNull()
    expect(qc.getQueryData(invDocsKeys.units('A'))).toBeUndefined()
    expect(qc.getQueryData(invDocsKeys.units('B'))).toBeUndefined()
    expect(qc.getQueryData(invDocsKeys.item('i1', 'A'))).toBeUndefined()
  })

  it('does not even ask when the captured company is no longer active', async () => {
    useCompanyStore.setState({ activeCompanyId: 'B' })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const units = vi.spyOn(lookupsApi, 'units').mockResolvedValue([unit])
    const items = vi.spyOn(lookupsApi, 'itemsByIds').mockResolvedValue([item])

    await expect(resolveItems(qc, ['i1'], 'A')).rejects.toThrow()
    await enrichDocument(qc, doc, 'A')

    expect(units).not.toHaveBeenCalled()
    expect(items).not.toHaveBeenCalled()
  })

  it('labels and caches under the company that stayed active', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(lookupsApi, 'units').mockResolvedValue([unit])
    vi.spyOn(lookupsApi, 'itemsByIds').mockResolvedValue([item])

    const out = await enrichDocument(qc, doc, 'A')

    expect(out.lines[0]).toMatchObject({ unit_code: 'PCS', item_code: 'STK-1' })
    expect(qc.getQueryData(invDocsKeys.item('i1', 'A'))).toEqual(item)
  })
})
