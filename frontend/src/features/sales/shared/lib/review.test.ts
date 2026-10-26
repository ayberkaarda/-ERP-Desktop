import { ApiError, platform } from '@/platform'
import { fetchAll, LIMIT_EXCEEDED } from '../api'
import type { SalesOrderLine } from '../types'
import { createKeyStore } from './idempotency'
import { exposureState } from './insights'
import { orderActions } from './lifecycle'
import { lineToValues, previewInput, toInput, emptyValues } from './lines'

const stored: SalesOrderLine = {
  id: 'l1',
  line_no: 1,
  item_id: 'i1',
  item_code: 'A',
  item_name: 'A',
  item_type: 'stock',
  variant_id: 'v-red',
  description: null,
  quantity: '10.000000',
  unit_id: 'u1',
  base_quantity: '10.000000',
  base_unit_id: 'u1',
  unit_price: '1.0000',
  price_source: 'price_list',
  discount_percent: '0',
  discount_amount: '0',
  net_amount: '10.0000',
  tax_code_id: null,
  tax_rate: '0',
  tax_amount: '0',
  line_total: '10.0000',
  warehouse_id: 'wh-2',
  source_line_id: null,
  delivered_quantity: '0.000000',
  invoiced_quantity: '0.000000',
  reservation_id: null,
}

describe('review fixes', () => {
  it('keeps a stored line variant and warehouse through the form, preview and save', () => {
    const values = {
      ...emptyValues('order', { today: '2026-10-21' }),
      partyId: 'p',
      lines: [lineToValues(stored)],
    }
    expect(toInput(values, 'order').lines?.[0]).toMatchObject({
      variant_id: 'v-red',
      warehouse_id: 'wh-2',
    })
    expect(previewInput(values, 'order')?.lines[0]).toMatchObject({
      variant_id: 'v-red',
      warehouse_id: 'wh-2',
    })
  })

  it('offers delivery and invoice with the same bounds as the wizard', () => {
    const tolerant = {
      status: 'partially_delivered' as const,
      over_delivery_percent: '10',
      lines: [{ ...stored, delivered_quantity: '10.000000', invoiced_quantity: '10.000000' }],
    }
    expect(orderActions(tolerant)).toContain('createDelivery')
    expect(orderActions({ ...tolerant, over_delivery_percent: '0' })).not.toContain(
      'createDelivery',
    )
    const overDelivered = {
      status: 'invoiced' as const,
      lines: [{ ...stored, delivered_quantity: '11.000000', invoiced_quantity: '10.000000' }],
    }
    expect(orderActions(overDelivered)).toEqual(['createInvoice', 'close'])
    expect(orderActions({ ...overDelivered, status: 'partially_invoiced' as const })).toContain(
      'createInvoice',
    )
  })

  it('counts only the change when revising an order already inside the exposure', () => {
    const e = {
      party_id: 'p',
      limit: '1000.0000',
      currency: 'TRY',
      open_invoices: '0.0000',
      open_orders: '600.0000',
      total: '600.0000',
      available: '400.0000',
    }
    expect(exposureState(e, '600.0000', 'TRY', '600.0000')).toEqual({ tone: 'ok', after: '400' })
    expect(exposureState(e, '1100.0000', 'TRY', '600.0000')).toEqual({
      tone: 'over',
      after: '-100',
    })
  })

  it('walks every lookup page and refuses to pass a capped list as complete', async () => {
    const get = vi.spyOn(platform.http, 'get').mockImplementation((_url, options) => {
      const page = Number(options?.params?.page)
      return Promise.resolve({
        data: [{ id: `u${page}` }],
        meta: { pagination: { current_page: page, per_page: 100, total: 12, last_page: 12 } },
      } as never)
    })
    expect(await fetchAll('/units')).toHaveLength(12)
    get.mockResolvedValue({
      data: [{ id: 'x' }],
      meta: { pagination: { current_page: 1, per_page: 100, total: 20_000, last_page: 200 } },
    })
    await expect(fetchAll('/units')).rejects.toMatchObject({ code: LIMIT_EXCEEDED })
    await expect(fetchAll('/units')).rejects.toBeInstanceOf(ApiError)
    get.mockRestore()
  })

  it('keeps a submission key across component lifetimes until released', () => {
    let n = 0
    const store = createKeyStore(() => `k${++n}`)
    expect(store.keyFor({ order: 'o', q: '1' })).toBe('k1')
    expect(store.keyFor({ q: '1', order: 'o' })).toBe('k1')
    store.release({ order: 'o', q: '1' })
    expect(store.keyFor({ order: 'o', q: '1' })).toBe('k2')
  })
})
