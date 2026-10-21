import type Decimal from 'decimal.js'
import { dec, isDecimal } from '../kit/money'
import type { CustomerExposure } from '../kit/types'

export interface DocumentInRisk {
  /** This document's amount and the currency it is shown in. */
  amount: string
  currency: string
  /** Risk left after the document, in the risk currency; null when it cannot be computed. */
  after: Decimal | null
}

interface InvoiceAmounts {
  currency_code: string
  total: string
  total_local?: string
}

/**
 * The document against the customer's risk limit. Amounts are only subtracted when they are in
 * the risk currency: the server's `document_amount` (converted with its rates), the document
 * total when the document is in that currency, or the local total when the risk currency is the
 * company's. Otherwise only the raw figures are shown.
 */
export function documentInRisk(
  e: CustomerExposure,
  inv: InvoiceAmounts,
  companyCurrency: string,
): DocumentInRisk {
  let amount: string | null = null
  if (isDecimal(e.document_amount ?? null)) amount = e.document_amount ?? null
  else if (inv.currency_code === e.currency) amount = inv.total
  else if (companyCurrency === e.currency && isDecimal(inv.total_local ?? null))
    amount = inv.total_local ?? null
  if (amount === null) return { amount: inv.total, currency: inv.currency_code, after: null }
  return {
    amount,
    currency: e.currency,
    after: e.available === null ? null : dec(e.available).minus(dec(amount)),
  }
}
