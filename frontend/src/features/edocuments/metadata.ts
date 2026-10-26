export type MetadataValues = Record<string, string>
export const addresses = [
  'supplier_address',
  'customer_address',
  'delivery_address',
  'export_delivery_address',
] as const
export const addressKeys = ['street', 'city', 'district', 'postal_code', 'country_code'] as const
const textKeys = [
  'issue_time',
  'tax_exemption_code',
  'tax_exemption_reason',
  'payment_iban',
  'export_delivery_terms',
  'export_transport_mode',
  'export_gtip',
  'export_package_type',
  'export_package_quantity',
  'export_package_id',
  'actual_despatch_date',
  'actual_despatch_time',
  'driver_first_name',
  'driver_last_name',
  'driver_tax_number',
  'vehicle_plate',
  'original_invoice_number',
  'original_invoice_date',
]
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function metadataValues(metadata: Record<string, unknown> = {}): MetadataValues {
  const values: MetadataValues = {}
  for (const key of textKeys) if (typeof metadata[key] === 'string') values[key] = metadata[key]
  for (const prefix of addresses) {
    const address = metadata[prefix]
    if (object(address))
      for (const key of addressKeys)
        if (typeof address[key] === 'string') values[`${prefix}.${key}`] = address[key]
  }
  if (object(metadata.unit_codes))
    Object.entries(metadata.unit_codes).forEach(([from, to], index) => {
      if (typeof to === 'string') {
        values[`unit.${index}.from`] = from
        values[`unit.${index}.to`] = to
      }
    })
  if (object(metadata.export_gtip_codes))
    for (const [line, code] of Object.entries(metadata.export_gtip_codes))
      if (typeof code === 'string') values[`gtip.${line}`] = code
  return values
}
export function buildMetadata(values: MetadataValues): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of textKeys) {
    const value = values[key]?.trim()
    if (value)
      result[key] =
        ['issue_time', 'actual_despatch_time'].includes(key) && /^\d{2}:\d{2}$/.test(value)
          ? `${value}:00`
          : value
  }
  for (const prefix of addresses) {
    const address: Record<string, string> = {}
    for (const key of addressKeys) {
      const value = values[`${prefix}.${key}`]?.trim()
      if (value) address[key] = value
    }
    if (Object.keys(address).length) result[prefix] = address
  }
  const units = Object.create(null) as Record<string, string>
  const codes = Object.create(null) as Record<string, string>
  for (const [key, value] of Object.entries(values)) {
    const unit = /^unit\.(\d+)\.from$/.exec(key)
    const target = unit ? values[`unit.${unit[1]}.to`]?.trim() : undefined
    if (unit && value.trim() && target) units[value.trim()] = target
    if (key.startsWith('gtip.') && value.trim()) codes[key.slice(5)] = value.trim()
  }
  if (Object.keys(units).length) result.unit_codes = units
  if (Object.keys(codes).length) result.export_gtip_codes = codes
  return result
}
