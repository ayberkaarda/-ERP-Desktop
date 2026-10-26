import type { SupplierExposure } from '../types'
import { dec } from './forms'

export type ExposureTone = 'none' | 'open' | 'overdue'

export interface ExposureView {
  tone: ExposureTone
  /** Exposure once this document counts too (null when it is not comparable or already in). */
  after: string | null
}

/**
 * Supplier exposure is informational (no limit): overdue payables warn, open payables or orders
 * inform. A draft's total in company currency is added to show what approving it means.
 */
export function exposureView(
  e: SupplierExposure,
  documentTotalLocal: string | null,
  /** The document is already counted (approved and later). */
  counted: boolean,
): ExposureView {
  const total = dec(e.total)
  const tone: ExposureTone = dec(e.overdue_payables).gt(0)
    ? 'overdue'
    : total.gt(0)
      ? 'open'
      : 'none'
  const extra = documentTotalLocal !== null && !counted ? dec(documentTotalLocal) : null
  return {
    tone,
    after: extra?.gt(0) ? total.plus(extra).toDecimalPlaces(2).toFixed(2) : null,
  }
}
