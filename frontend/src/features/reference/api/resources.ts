import { ApiError, platform, withIdempotency } from '@/platform'
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
  /** Activation is per company (PATCH /currencies/{uuid} {is_active, version}); rows are global. */
  setActive: async (currency: Pick<Currency, 'id' | 'version'>, isActive: boolean) =>
    (
      await platform.http.patch<ItemResponse<Currency>>(
        `/currencies/${encodeURIComponent(currency.id)}`,
        { is_active: isActive, version: currency.version },
      )
    ).data,
}

/** True for a 404, which /exchange-rates/latest answers when a currency has no rate yet. */
function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

export const exchangeRatesApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    platform.http.get<ListResponse<ExchangeRate>>('/exchange-rates', {
      params: toListParams(query),
      signal,
    }),
  /** GET /exchange-rates/latest?currency=XXX: one rate (manual wins on the same day), 404 if none. */
  latestFor: async (currency: string, signal?: AbortSignal): Promise<ExchangeRate | null> => {
    try {
      return (
        await platform.http.get<ItemResponse<ExchangeRate>>('/exchange-rates/latest', {
          params: { currency },
          signal,
        })
      ).data
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  },
  /** Latest rate of each given currency, skipping those without one. */
  latest: async (currencies: readonly string[], signal?: AbortSignal) => {
    const rows = await Promise.all(currencies.map((c) => exchangeRatesApi.latestFor(c, signal)))
    return rows.filter((r): r is ExchangeRate => r !== null)
  },
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
