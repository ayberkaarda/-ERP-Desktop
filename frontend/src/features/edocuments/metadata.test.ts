import { buildMetadata, metadataValues } from './metadata'

it('builds typed profile fields, addresses, per-line tariff codes and unit mappings without empty overrides', () => {
  const result = buildMetadata({
    payment_iban: ' TR330006100519786457841326 ',
    'supplier_address.street': ' Main Street ',
    'supplier_address.city': 'Ankara',
    'supplier_address.country_code': 'TR',
    'customer_address.street': '',
    'unit.0.from': 'ADET',
    'unit.0.to': 'C62',
    'gtip.1': '123456789012',
    export_package_quantity: '1234567890123.000001',
  })
  expect(result).toEqual({
    payment_iban: 'TR330006100519786457841326',
    supplier_address: { street: 'Main Street', city: 'Ankara', country_code: 'TR' },
    unit_codes: { ADET: 'C62' },
    export_gtip_codes: { '1': '123456789012' },
    export_package_quantity: '1234567890123.000001',
  })
  expect(result).not.toHaveProperty('customer_address')
})
it('round trips editable server metadata without converting decimal strings to floats', () => {
  const metadata = {
    actual_despatch_date: '2026-10-23',
    actual_despatch_time: '15:30:00',
    driver_first_name: 'Ali',
    driver_last_name: 'Yılmaz',
    driver_tax_number: '12345678901',
    unit_codes: { ADET: 'C62', KG: 'KGM' },
    export_gtip_codes: { '1': '123456789012' },
    customer_address: { street: 'A <script>', city: 'İstanbul', country_code: 'TR' },
    export_package_quantity: '0.000001',
  }
  expect(buildMetadata(metadataValues(metadata))).toEqual(metadata)
})
it('does not turn malicious unit or line keys into object prototypes', () => {
  const result = buildMetadata({
    'unit.0.from': '__proto__',
    'unit.0.to': 'C62',
    'gtip.__proto__': '123456789012',
  })
  expect(Object.getPrototypeOf(result.unit_codes)).toBeNull()
  expect(JSON.stringify(result)).toContain('"__proto__":"C62"')
  expect({}).not.toHaveProperty('polluted')
})
it('normalizes native minute-only time values and preserves return invoice references', () => {
  expect(
    buildMetadata({
      actual_despatch_time: '10:30',
      issue_time: '10:30:59',
      original_invoice_number: 'ABC2026000000001',
      original_invoice_date: '2026-10-01',
    }),
  ).toEqual({
    actual_despatch_time: '10:30:00',
    issue_time: '10:30:59',
    original_invoice_number: 'ABC2026000000001',
    original_invoice_date: '2026-10-01',
  })
})
