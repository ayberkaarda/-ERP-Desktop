import type { Allocation, Direction, OpenItem } from '../shared/types'
export const paymentAllocationInput = (lines: Allocation[]) =>
  lines.map(({ invoice_module, invoice_id, amount, fx_rate }) => ({
    invoice_module,
    invoice_id,
    amount,
    fx_rate,
  }))
export const instrumentAllocationInput = (lines: Allocation[]) =>
  lines.map(({ invoice_module, invoice_id, amount }) => ({ invoice_module, invoice_id, amount }))
export function compatibleInvoice(invoice: OpenItem, direction: Direction): boolean {
  const returned = ['return', 'credit_note', 'debit_note'].includes(invoice.invoice_type)
  return invoice.module === 'sales'
    ? direction === (returned ? 'payment' : 'receipt')
    : direction === (returned ? 'receipt' : 'payment')
}
export function compatibleInstrumentInvoice(
  invoice: OpenItem,
  direction: Direction,
  currency: string | undefined,
): boolean {
  return (
    invoice.module === (direction === 'receipt' ? 'sales' : 'purchasing') &&
    !['return', 'credit_note', 'debit_note'].includes(invoice.invoice_type) &&
    (!currency || invoice.currency_code === currency)
  )
}
