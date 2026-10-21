import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import {
  costCentersApi,
  currenciesApi,
  exchangeRatesApi,
  locationsApi,
  paymentTermsApi,
  projectsApi,
  settingsApi,
  taxCodesApi,
  warehousesApi,
} from '../api/resources'
import { BASE_CURRENCY_KEY, type ExchangeRateInput, type LocationInput } from '../types'
import { refKeys } from './keys'
import { createCrudHooks } from './useCrud'

const taxCodes = createCrudHooks('tax-codes', taxCodesApi)
const paymentTerms = createCrudHooks('payment-terms', paymentTermsApi)
const warehouses = createCrudHooks('warehouses', warehousesApi)
const costCenters = createCrudHooks('cost-centers', costCentersApi)
const projects = createCrudHooks('projects', projectsApi)

export const useTaxCodeList = taxCodes.useList
export const useCreateTaxCode = taxCodes.useCreate
export const useUpdateTaxCode = taxCodes.useUpdate
export const useRemoveTaxCode = taxCodes.useRemove
export const usePaymentTermList = paymentTerms.useList
export const useCreatePaymentTerm = paymentTerms.useCreate
export const useUpdatePaymentTerm = paymentTerms.useUpdate
export const useRemovePaymentTerm = paymentTerms.useRemove
export const useWarehouseList = warehouses.useList
export const useCreateWarehouse = warehouses.useCreate
export const useUpdateWarehouse = warehouses.useUpdate
export const useRemoveWarehouse = warehouses.useRemove
export const useCostCenters = costCenters.useAll
export const useCreateCostCenter = costCenters.useCreate
export const useUpdateCostCenter = costCenters.useUpdate
export const useRemoveCostCenter = costCenters.useRemove
export const useProjectList = projects.useList
export const useCreateProject = projects.useCreate
export const useUpdateProject = projects.useUpdate
export const useRemoveProject = projects.useRemove

// ---- Hooks exported for other features ----------------------------------------------------

/** All currencies; `activeOnly` keeps those activated for the current company. */
export function useCurrencies(options: { activeOnly?: boolean } = {}) {
  const activeOnly = options.activeOnly ?? false
  return useQuery({
    queryKey: refKeys.full('currencies'),
    queryFn: ({ signal }) => currenciesApi.all(signal),
    staleTime: 60_000,
    select: (rows) => (activeOnly ? rows.filter((c) => c.is_active) : rows),
  })
}

/** All tax codes (global and company-specific); active ones only unless asked otherwise. */
export function useTaxCodes(options: { type?: string; includeInactive?: boolean } = {}) {
  const params: Record<string, string> = {}
  if (options.type) params['filter[type]'] = options.type
  if (!options.includeInactive) params['filter[is_active]'] = '1'
  return taxCodes.useAll(params)
}

export function useWarehouses(options: { includeInactive?: boolean } = {}) {
  return warehouses.useAll(options.includeInactive ? undefined : { 'filter[is_active]': '1' })
}

export function useWarehouse(id: string) {
  return useQuery({
    queryKey: [...refKeys.resource('warehouses'), 'one', id] as const,
    queryFn: ({ signal }) => warehousesApi.get(id, signal),
  })
}

export function usePaymentTerms(options: { includeInactive?: boolean } = {}) {
  return paymentTerms.useAll(options.includeInactive ? undefined : { 'filter[is_active]': '1' })
}

// ---- Currencies, rates, settings -----------------------------------------------------------

export function useCurrencyList(query: ListQueryState) {
  return useQuery({
    queryKey: refKeys.list('currencies', query),
    queryFn: ({ signal }) => currenciesApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useSetCurrencyActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, isActive }: { code: string; isActive: boolean }) =>
      currenciesApi.setActive(code, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: refKeys.resource('currencies') }),
  })
}

export function useRateList(query: ListQueryState) {
  return useQuery({
    queryKey: refKeys.list('exchange-rates', query),
    queryFn: ({ signal }) => exchangeRatesApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useLatestRates() {
  return useQuery({
    queryKey: refKeys.latestRates(),
    queryFn: ({ signal }) => exchangeRatesApi.latest(signal),
  })
}

export function useRateStatus() {
  return useQuery({
    queryKey: refKeys.rateStatus(),
    queryFn: ({ signal }) => exchangeRatesApi.status(signal),
  })
}

export function useCreateRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ input, key }: { input: ExchangeRateInput; key?: string }) =>
      exchangeRatesApi.create(input, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: refKeys.resource('exchange-rates') }),
  })
}

export function useBaseCurrency() {
  return useQuery({
    queryKey: refKeys.settings(),
    queryFn: ({ signal }) => settingsApi.group(signal),
    select: (rows) => {
      const row = rows.find((r) => r.key === BASE_CURRENCY_KEY)
      const value = row?.value ?? row?.default
      return typeof value === 'string' ? value : null
    },
  })
}

export function useSetBaseCurrency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => settingsApi.setBaseCurrency(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: refKeys.settings() }),
  })
}

// ---- Warehouse locations -------------------------------------------------------------------

export function useLocations(warehouseId: string) {
  return useQuery({
    queryKey: refKeys.locations(warehouseId),
    queryFn: ({ signal }) => locationsApi.all(warehouseId, signal),
  })
}

export function useLocationMutations(warehouseId: string) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: refKeys.locations(warehouseId) })
  const create = useMutation({
    mutationFn: ({ input, key }: { input: LocationInput; key?: string }) =>
      locationsApi.create(warehouseId, input, key),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({
      id,
      version,
      patch,
    }: {
      id: string
      version: number
      patch: Partial<LocationInput>
    }) => locationsApi.update(warehouseId, id, version, patch),
    onSuccess: invalidate,
  })
  return { create, update }
}
