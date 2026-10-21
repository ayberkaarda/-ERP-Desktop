import { platform, withIdempotency } from '@/platform'
import type {
  CostCenter,
  CostCenterInput,
  Currency,
  ExchangeRate,
  ExchangeRateInput,
  ItemResponse,
  ListResponse,
  LocationInput,
  PaymentTerm,
  PaymentTermInput,
  Project,
  ProjectInput,
  RateStatus,
  SettingRow,
  TaxCode,
  TaxCodeInput,
  Warehouse,
  WarehouseInput,
  WarehouseLocation,
} from '../types'
import { BASE_CURRENCY_KEY } from '../types'
import { createCrudApi, fetchAll } from './client'
import type { ListQueryState } from '@/components/shared/data-table'
import { toListParams } from '@/components/shared/data-table'

export const taxCodesApi = createCrudApi<TaxCode, TaxCodeInput>('/tax-codes')
export const paymentTermsApi = createCrudApi<PaymentTerm, PaymentTermInput>('/payment-terms')
export const warehousesApi = createCrudApi<Warehouse, WarehouseInput>('/warehouses')
export const costCentersApi = createCrudApi<CostCenter, CostCenterInput>('/cost-centers')
export const projectsApi = createCrudApi<Project, ProjectInput>('/projects')

export const currenciesApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    platform.http.get<ListResponse<Currency>>('/currencies', {
      params: toListParams(query),
      signal,
    }),
  all: (signal?: AbortSignal) => fetchAll<Currency>('/currencies', {}, signal),
  /** Activation is per company; currency rows themselves are global. */
  setActive: async (code: string, isActive: boolean) =>
    (
      await platform.http.patch<ItemResponse<Currency>>(`/currencies/${encodeURIComponent(code)}`, {
        is_active: isActive,
      })
    ).data,
}

export const exchangeRatesApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    platform.http.get<ListResponse<ExchangeRate>>('/exchange-rates', {
      params: toListParams(query),
      signal,
    }),
  latest: async (signal?: AbortSignal) =>
    (await platform.http.get<ListResponse<ExchangeRate>>('/exchange-rates/latest', { signal }))
      .data,
  status: async (signal?: AbortSignal) =>
    (await platform.http.get<ItemResponse<RateStatus>>('/exchange-rates/status', { signal })).data,
  create: async (input: ExchangeRateInput, key?: string) =>
    (
      await platform.http.post<ItemResponse<ExchangeRate>>(
        '/exchange-rates',
        input,
        withIdempotency({}, key),
      )
    ).data,
}

export const locationsApi = {
  all: (warehouseId: string, signal?: AbortSignal) =>
    fetchAll<WarehouseLocation>(
      `/warehouses/${encodeURIComponent(warehouseId)}/locations`,
      {},
      signal,
    ),
  create: async (warehouseId: string, input: LocationInput, key?: string) =>
    (
      await platform.http.post<ItemResponse<WarehouseLocation>>(
        `/warehouses/${encodeURIComponent(warehouseId)}/locations`,
        input,
        withIdempotency({}, key),
      )
    ).data,
  update: async (warehouseId: string, id: string, version: number, patch: Partial<LocationInput>) =>
    (
      await platform.http.patch<ItemResponse<WarehouseLocation>>(
        `/warehouses/${encodeURIComponent(warehouseId)}/locations/${encodeURIComponent(id)}`,
        { ...patch, version },
      )
    ).data,
}

export const settingsApi = {
  group: async (signal?: AbortSignal) =>
    (await platform.http.get<ListResponse<SettingRow>>('/settings', { signal })).data,
  setBaseCurrency: async (code: string) => {
    await platform.http.patch<unknown>('/settings', { settings: { [BASE_CURRENCY_KEY]: code } })
  },
}
