import { useQuery } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { formatDecimalDisplay } from '@/lib/money'
import { anyOf, usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'

/** Backend gate `sales-customer-view`: any of the three document read permissions. */
export const CUSTOMER_SALES_VIEW = anyOf(
  'sales.quotes.view',
  'sales.orders.view',
  'sales.invoices.view',
)

/** GET /customers/{id}/exposure, in the party's risk currency (scale 2). */
export interface CustomerExposureData {
  party_id: string
  /** null = no risk limit (unlimited). */
  limit: string | null
  currency: string
  open_invoices: string
  open_orders: string
  total: string
  available: string | null
}

export interface SummaryLink {
  id: string
  document_type: string
  number: string | null
  status: string
  document_date: string
  total: string
  currency_code: string
}

/** GET /customers/{id}/sales-summary; amounts in company currency except `exposure`. */
export interface CustomerSalesSummaryData {
  party_id: string
  currency: string
  exposure: CustomerExposureData
  quotes: { open_count: number; open_total: string }
  orders: { open_count: number; open_value: string }
  invoices: {
    count: number
    invoiced_total: string
    credited_total: string
    balance_due: string
    last_invoice_date: string | null
  }
  recent_orders: SummaryLink[]
  recent_invoices: (SummaryLink & { balance_due: string })[]
}

// Under the sales root so every sales mutation (invalidateSales) refreshes them too.
export const customerKeys = {
  exposure: (companyId: string | null, partyId: string) =>
    ['sales', companyId, 'customers', partyId, 'exposure'] as const,
  summary: (companyId: string | null, partyId: string) =>
    ['sales', companyId, 'customers', partyId, 'summary'] as const,
}

const seg = (id: string) => encodeURIComponent(id)
const DECIMAL = /^-?\d+(?:\.\d+)?$/

export function useCustomerExposure(partyId: string, enabled = true) {
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  const allowed = usePermission(CUSTOMER_SALES_VIEW)
  return useQuery({
    queryKey: customerKeys.exposure(companyId, partyId),
    queryFn: ({ signal }) =>
      platform.http
        .get<{ data: CustomerExposureData }>(`/customers/${seg(partyId)}/exposure`, { signal })
        .then((r) => r.data),
    enabled: enabled && allowed && partyId !== '',
    staleTime: 15_000,
  })
}

export function useCustomerSalesSummary(partyId: string) {
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  const allowed = usePermission(CUSTOMER_SALES_VIEW)
  return useQuery({
    queryKey: customerKeys.summary(companyId, partyId),
    queryFn: ({ signal }) =>
      platform.http
        .get<{
          data: CustomerSalesSummaryData
        }>(`/customers/${seg(partyId)}/sales-summary`, { signal })
        .then((r) => r.data),
    enabled: allowed && partyId !== '',
  })
}

/** Reading format: 2 decimals with grouping and an optional currency code. */
export function formatAmount(value: string | null | undefined, locale: string, currency?: string) {
  if (value == null || !DECIMAL.test(value)) return ''
  const text = formatDecimalDisplay(value, { locale })
  return currency ? `${text} ${currency}` : text
}

export const isNegative = (value: string | null | undefined) =>
  value != null && DECIMAL.test(value) && new Decimal(value).lessThan(0)

/** Share of the limit already used, 0..100+ (null without a limit). */
export function usedPercent(e: CustomerExposureData): number | null {
  if (e.limit === null) return null
  const limit = new Decimal(e.limit)
  if (!limit.greaterThan(0)) return null
  return new Decimal(e.total).div(limit).times(100).toDecimalPlaces(0).toNumber()
}

const DOC_PATHS: Record<string, string> = {
  sales_quote: '/sales/quotes',
  sales_order: '/sales/orders',
  sales_delivery: '/sales/deliveries',
  sales_invoice: '/sales/invoices',
  sales_credit_note: '/sales/invoices',
  sales_return: '/sales/returns',
}

export const documentHref = (link: SummaryLink) =>
  `${DOC_PATHS[link.document_type] ?? '/sales/invoices'}/${seg(link.id)}`
