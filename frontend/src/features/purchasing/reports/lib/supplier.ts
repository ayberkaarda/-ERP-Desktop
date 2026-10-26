import { useQuery } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { dec, isDecimal } from '@/features/sales/invoices/kit/money'
import { toIsoDate } from '@/lib/datetime'
import { useCompanyStore } from '@/stores/company'
import { http, seg } from '../../invoices/kit/http'
import { purchKeys } from '../../invoices/kit/keys'
import type {
  Envelope,
  SupplierPerformance,
  SupplierPurchaseSummaryData,
} from '../../invoices/kit/types'

export function useSupplierSummary(partyId: string, enabled = true) {
  useCompanyStore((s) => s.activeCompanyId)
  return useQuery({
    queryKey: purchKeys.summary(partyId),
    queryFn: ({ signal }) =>
      http()
        .get<Envelope<SupplierPurchaseSummaryData>>(`/suppliers/${seg(partyId)}/purchase-summary`, {
          signal,
        })
        .then((r) => r.data),
    enabled: enabled && partyId !== '',
    staleTime: 30_000,
  })
}

/** Default performance window: the last twelve months up to today (as the API defaults). */
export function lastTwelveMonths(today = new Date()): { from: string; to: string } {
  const from = new Date(today)
  from.setFullYear(from.getFullYear() - 1)
  return { from: toIsoDate(from), to: toIsoDate(today) }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function useSupplierPerformance(
  partyId: string,
  range: { from: string; to: string },
  enabled = true,
) {
  useCompanyStore((s) => s.activeCompanyId)
  return useQuery({
    queryKey: purchKeys.performance(partyId, range),
    queryFn: ({ signal }) =>
      http()
        .get<Envelope<SupplierPerformance>>(`/suppliers/${seg(partyId)}/performance`, {
          params: { from: range.from, to: range.to },
          signal,
        })
        .then((r) => r.data),
    enabled:
      enabled &&
      partyId !== '' &&
      DAY.test(range.from) &&
      DAY.test(range.to) &&
      range.from <= range.to,
    staleTime: 30_000,
  })
}

/** A 0..1 rate (decimal string) as a percent string with one decimal; null stays null. */
export function ratePercent(rate: string | null | undefined): string | null {
  if (!isDecimal(rate)) return null
  return dec(rate).mul(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString()
}

/**
 * Tone of a performance figure for the risk read-out: on-time / fill below 80% and returns
 * above 5% warn, below 60% / above 10% are bad. Thresholds are display hints only.
 */
export function rateTone(
  kind: 'higher_better' | 'lower_better',
  percent: string | null,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (percent === null) return 'neutral'
  const p = dec(percent)
  if (kind === 'higher_better')
    return p.lessThan(60) ? 'danger' : p.lessThan(80) ? 'warning' : 'success'
  return p.greaterThan(10) ? 'danger' : p.greaterThan(5) ? 'warning' : 'success'
}
