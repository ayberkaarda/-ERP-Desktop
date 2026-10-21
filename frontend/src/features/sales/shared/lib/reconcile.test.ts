import { DEFAULT_LIST_QUERY } from '@/components/shared/data-table'
import { flattenLinks, taxBreakdown, toPreviewTotals } from '../api'
import type { PreviewTotalsInput, SalesLine, WirePreview } from '../types'
import { priceSourceGroup } from './lines'
import { sanitizeListQuery } from './listFilters'

const link = (id: string, document_type: string, number: string | null = null) => ({
  id,
  document_type: document_type as 'sales_quote',
  number,
  status: 'draft',
  document_date: '2026-10-20',
  total: '120.0000',
  currency_code: 'TRY',
})

describe('API shapes of the Sales module', () => {
  it('turns the links object into one list with directions by stage and relation', () => {
    const order = flattenLinks(
      {
        quote: link('q1', 'sales_quote', 'QUO2026000000001'),
        deliveries: [link('d1', 'sales_delivery'), link('d2', 'sales_delivery')],
        invoices: [],
      },
      'sales_order',
    )
    expect(order.map((l) => [l.id, l.type, l.direction])).toEqual([
      ['q1', 'sales_quote', 'upstream'],
      ['d1', 'sales_delivery', 'downstream'],
      ['d2', 'sales_delivery', 'downstream'],
    ])
    const quote = flattenLinks(
      {
        previous_revision: link('q0', 'sales_quote'),
        next_revisions: [link('q2', 'sales_quote')],
        order: link('o1', 'sales_order'),
      },
      'sales_quote',
    )
    expect(quote.map((l) => [l.id, l.direction])).toEqual([
      ['q0', 'upstream'],
      ['q2', 'downstream'],
      ['o1', 'downstream'],
    ])
    expect(flattenLinks({ order: null }, 'sales_quote')).toEqual([])
  })

  it('derives the tax table from the lines per tax code and rate', () => {
    const line = (tax: string | null, rate: string, net: string, amount: string) =>
      ({
        tax_code_id: tax,
        tax_rate: rate,
        net_amount: net,
        tax_amount: amount,
      }) as SalesLine
    expect(
      taxBreakdown([
        line('t20', '20.000000', '100.0000', '20.0000'),
        line('t20', '20.000000', '50.0000', '10.0000'),
        line(null, '0.000000', '30.0000', '0.0000'),
      ]),
    ).toEqual([
      {
        tax_code_id: 't20',
        tax_code: null,
        rate: '20.000000',
        base: '150.0000',
        amount: '30.0000',
      },
      { tax_code_id: null, tax_code: null, rate: '0.000000', base: '30.0000', amount: '0.0000' },
    ])
  })

  it('maps preview-totals lines back to the request keys and warnings by line index', () => {
    const input = {
      document_type: 'quote',
      party_id: 'p',
      document_date: '2026-10-21',
      currency_code: 'EUR',
      fx_rate: null,
      price_list_id: null,
      warehouse_id: null,
      lines: [{ key: 'a' }, { key: 'b' }],
    } as unknown as PreviewTotalsInput
    const row = (price: string, source: string, resolved: string | null) => ({
      unit_price: price,
      price_source: source,
      base_quantity: '1.000000',
      net_amount: price,
      tax_code_id: 't20',
      tax_rate: '20.000000',
      tax_amount: '2.00',
      line_total: '12.00',
      pricing: { unit_price: resolved },
    })
    const data = {
      header: { currency_code: 'EUR', fx_rate: '35.500000' },
      lines: [
        row('10.000000', 'default_price_list', '10.000000'),
        row('9.000000', 'manual', '10.000000'),
      ],
      taxes: [
        {
          tax_code_id: 't20',
          rate: '20.000000',
          base: '19.00',
          tax: '3.80',
          base_local: '674.50',
          tax_local: '134.90',
        },
      ],
      totals: {
        subtotal: '20.00',
        discount_total: '1.00',
        tax_total: '3.80',
        total: '22.80',
        subtotal_local: '710.00',
        discount_total_local: '35.50',
        tax_total_local: '134.90',
        total_local: '809.40',
      },
      price_overrides: [{ line: 1, resolved: '10.000000', given: '9.000000' }],
    } as unknown as WirePreview
    const out = toPreviewTotals(input, data, [
      { code: 'sales.price_override_forbidden', message: 'No', line: 1 },
    ])
    expect(out.lines.map((l) => [l.key, l.unit_price, l.resolved_price])).toEqual([
      ['a', '10.000000', '10.000000'],
      ['b', '9.000000', '10.000000'],
    ])
    expect(out).toMatchObject({
      total: '22.80',
      total_local: '809.40',
      fx_rate: '35.500000',
      local_currency_code: null,
      tax_breakdown: [{ tax_code_id: 't20', base: '19.00', amount: '3.80' }],
    })
    expect(out.warnings[0]).toMatchObject({ line_key: 'b', code: 'sales.price_override_forbidden' })
  })

  it('groups the price sources the API records', () => {
    expect(
      ['party_price_list', 'default_price_list', 'manual', 'source', 'none', null].map(
        priceSourceGroup,
      ),
    ).toEqual(['list', 'list', 'manual', 'source', 'none', 'none'])
  })

  it('drops sorts the sales lists do not accept', () => {
    const q = sanitizeListQuery(
      {
        ...DEFAULT_LIST_QUERY,
        sort: [
          { id: 'valid_until', desc: false },
          { id: 'total', desc: true },
        ],
      },
      true,
    )
    expect(q.sort).toEqual([{ id: 'total', desc: true }])
  })
})
