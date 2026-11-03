import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import { addDesktopResources } from '../../i18n'
import { createDesktopText } from '../../sync'
import { differingFields, fieldName, humanize, recordLabel, resourceName, sameValue, shortId } from './labels'

async function text(language = 'tr') {
  const i18n = i18next.createInstance()
  await i18n.init({ lng: language, fallbackLng: 'tr', resources: {} })
  addDesktopResources(i18n)
  return createDesktopText(i18n)
}

describe('record labels', () => {
  it('a party or an item is named by its name', () => {
    expect(recordLabel('parties', { name: ' Ankara Gıda Ltd. ', code: 'P1' }, '(numarasız)')).toBe('Ankara Gıda Ltd.')
  })

  it('a document is its number with the party, or unnumbered with the party', () => {
    expect(recordLabel('sales-quotes', { number: 'QUO-1', party_name: 'Acme' }, '(numarasız)')).toBe('QUO-1 · Acme')
    expect(recordLabel('sales-quotes', { number: null, party_name: 'Acme' }, '(numarasız)')).toBe('(numarasız) · Acme')
    expect(recordLabel('sales-orders', { party: { name: 'Beta' } }, '(numarasız)')).toBe('(numarasız) · Beta')
  })

  it('falls back to the code, else to nothing', () => {
    expect(recordLabel('units', { code: 'KG' }, '-')).toBe('KG')
    expect(recordLabel('sales-quotes', { notes: 'x' }, '-')).toBeNull()
    expect(recordLabel('sales-quotes', null, '-')).toBeNull()
    expect(shortId('01a1a32e-9bbd-71a0-91cd-404d22263479')).toBe('…263479')
  })
})

describe('resource and field names', () => {
  it('are localized, with a readable fallback', async () => {
    const tr = await text()
    expect(resourceName(tr, 'sales-quotes')).toBe('Satış teklifi')
    expect(resourceName(tr, 'items.variants')).toBe('Varyant')
    expect(resourceName(tr, 'bank-accounts')).toBe('Bank accounts')
    expect(fieldName(tr, 'tax_number')).toBe('Vergi numarası')
    expect(fieldName(tr, 'customer_reference_id')).toBe('Customer reference')
    expect(humanize('payment_term_id')).toBe('Payment term')
    const en = await text('en')
    expect(resourceName(en, 'parties')).toBe('Party')
    expect(fieldName(en, 'notes')).toBe('Notes')
  })
})

describe('fields of a version conflict', () => {
  it('only notes when only notes changed (round 1: 18 fields listed)', () => {
    const fields = [
      'billing_address', 'discount_total', 'discount_total_local', 'due_date', 'internal_notes', 'lines',
      'notes', 'party_name', 'party_tax_number', 'party_tax_office', 'payment_term_id', 'price_list_id',
      'subtotal', 'subtotal_local', 'tax_total', 'tax_total_local', 'valid_until', 'warehouse_id',
    ]
    const server = {
      notes: 'Teslimat perşembe',
      party_name: 'Ankara Gıda Ltd.',
      valid_until: '2026-12-02T00:00:00Z',
      subtotal: '200.00',
      lines: [{ id: 'l1', item_id: 'i1', quantity: '2.000', unit_price: '100.00', line_total: '200.00' }],
      payment_term_id: 'pt',
      internal_notes: null,
    }
    const mine = {
      notes: 'Teslimat cuma günü yapılacak',
      valid_until: '2026-12-02',
      subtotal: 999,
      lines: [{ item_id: 'i1', quantity: 2, unit_price: 100 }],
      payment_term_id: 'pt',
      internal_notes: '',
    }
    expect(differingFields(fields, mine, server)).toEqual(['notes'])
  })

  it('never asks about a field the draft did not send or the server owns', () => {
    const fields = ['due_date', 'party_name', 'subtotal_local', 'fx_rate', 'status', 'notes']
    const server = { due_date: '2026-12-01', party_name: 'Eski', subtotal_local: '1.00', fx_rate: '1', status: 'sent', notes: 'b' }
    const mine = { party_name: 'Yeni', subtotal_local: '2.00', fx_rate: '2', status: 'draft', notes: 'a' }
    expect(differingFields(fields, mine, server)).toEqual(['notes'])
  })

  it('changed lines are one row', () => {
    const server = { lines: [{ id: 'l1', item_id: 'i1', quantity: '2.000' }] }
    const mine = { lines: [{ item_id: 'i1', quantity: 3 }] }
    expect(differingFields(['lines'], mine, server)).toEqual(['lines'])
    expect(differingFields(['lines'], { lines: [] }, server)).toEqual(['lines'])
  })

  it('compares numbers, dates and blanks by value', () => {
    expect(sameValue('10.50', 10.5)).toBe(true)
    expect(sameValue('2026-12-02', '2026-12-02T00:00:00.000000Z')).toBe(true)
    expect(sameValue(null, '')).toBe(true)
    expect(sameValue('a', 'b')).toBe(false)
    expect(sameValue(true, false)).toBe(false)
  })
})

describe('labels of real editable fields', () => {
  it('are Turkish on a Turkish screen, server error paths included', async () => {
    const tr = await text()
    const names = [
      'legal_name', 'type', 'country', 'default_currency_code', 'risk_limit', 'risk_currency_code', 'tags',
      'due_date', 'cost_center_id', 'project_id', 'requested_delivery_date',
    ].map((field) => fieldName(tr, field))
    expect(names).toEqual([
      'Ticari unvan', 'Tür', 'Ülke', 'Varsayılan para birimi', 'Risk limiti', 'Risk para birimi',
      'Etiketler', 'Vade tarihi', 'Masraf merkezi', 'Proje', 'İstenen teslim tarihi',
    ])
    expect(fieldName(tr, 'lines.0.quantity')).toBe('Satır 1 · Miktar')
    expect(fieldName(tr, 'lines.2.serial_numbers.0')).toBe('Satır 3 · Seri numaraları')
    expect(fieldName(tr, 'tags.1')).toBe('Etiketler')
    expect(fieldName(tr, 'billing_address.city')).toBe('Fatura adresi · City')
    expect(fieldName(await text('de'), 'lines.0.unit_price')).toBe('Position 1 · Einzelpreis')
  })
})

describe('text that looks like a number', () => {
  it('keeps its leading zeros', () => {
    const mine = { phone: '05321234567', tax_number: '0123456789', code: '001' }
    const server = { phone: '5321234567', tax_number: '123456789', code: '1' }
    expect(differingFields(['phone', 'tax_number', 'code'], mine, server)).toEqual(['phone', 'tax_number', 'code'])
  })

  it('decimal fields still compare by value, lines included', () => {
    const mine = { risk_limit: '1000', lines: [{ quantity: '2', unit_price: '10.5' }] }
    const server = { risk_limit: '1000.00', lines: [{ id: 'l', quantity: '2.000', unit_price: '10.50' }] }
    expect(differingFields(['risk_limit', 'lines'], mine, server)).toEqual([])
  })
})
