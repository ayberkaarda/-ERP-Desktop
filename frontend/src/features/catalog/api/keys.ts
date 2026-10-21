import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import type { PricingQuery } from '../types'

// Every key starts with the active company so a company switch never shows stale rows.
const company = () => useCompanyStore.getState().activeCompanyId ?? 'none'
const root = () => ['catalog', company()] as const

export const catalogKeys = {
  all: () => root(),
  units: () => [...root(), 'units'] as const,
  unitList: (q: ListQueryState) => [...root(), 'units', 'list', q] as const,
  unitAll: () => [...root(), 'units', 'all'] as const,
  conversions: () => [...root(), 'unit-conversions'] as const,
  categories: () => [...root(), 'categories'] as const,
  items: () => [...root(), 'items'] as const,
  itemList: (q: ListQueryState) => [...root(), 'items', 'list', q] as const,
  item: (id: string) => [...root(), 'items', 'detail', id] as const,
  itemSearch: (q: string) => [...root(), 'items', 'search', q] as const,
  variants: (itemId: string) => [...root(), 'items', 'detail', itemId, 'variants'] as const,
  barcodes: (itemId: string) => [...root(), 'items', 'detail', itemId, 'barcodes'] as const,
  itemUnits: (itemId: string) => [...root(), 'items', 'detail', itemId, 'units'] as const,
  priceLists: () => [...root(), 'price-lists'] as const,
  priceListList: (q: ListQueryState) => [...root(), 'price-lists', 'list', q] as const,
  priceList: (id: string) => [...root(), 'price-lists', 'detail', id] as const,
  priceListLines: (id: string) => [...root(), 'price-lists', 'detail', id, 'lines'] as const,
  discountRules: () => [...root(), 'discount-rules'] as const,
  discountRuleList: (q: ListQueryState) => [...root(), 'discount-rules', 'list', q] as const,
  pricing: (q: PricingQuery) => [...root(), 'pricing', q] as const,
  currencies: () => [...root(), 'lookups', 'currencies'] as const,
  taxCode: (id: string) => [...root(), 'lookups', 'tax-code', id] as const,
  party: (id: string) => [...root(), 'lookups', 'party', id] as const,
}
