import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { accountsApi, fiscalYearsApi, periodsApi, rulesApi } from './api'
import { accKeys } from './keys'
import type {
  AccountInput,
  AccountingPeriod,
  DeterminationRuleInput,
  FiscalYear,
  FiscalYearInput,
  PeriodAction,
} from './types'

// --- Accounts -------------------------------------------------------------------------------

export function useAccountList(query: ListQueryState, enabled = true) {
  return useQuery({
    queryKey: accKeys.accountList(query),
    queryFn: ({ signal }) => accountsApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useAccountTree(enabled = true) {
  return useQuery({
    queryKey: accKeys.accountTree(),
    queryFn: ({ signal }) => accountsApi.tree(signal),
    staleTime: 60_000,
    enabled,
  })
}

export function useAccount(id: string | null) {
  return useQuery({
    queryKey: accKeys.account(id ?? ''),
    queryFn: ({ signal }) => accountsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useAccountBalance(id: string | null, asOf: string) {
  return useQuery({
    queryKey: accKeys.balance(id ?? '', asOf),
    queryFn: ({ signal }) => accountsApi.balance(id ?? '', asOf, signal),
    enabled: Boolean(id) && /^\d{4}-\d{2}-\d{2}$/.test(asOf),
  })
}

function useInvalidate(key: readonly unknown[]) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: key })
}

export function useSaveAccount() {
  const invalidate = useInvalidate(accKeys.accounts())
  return useMutation({
    mutationFn: (
      args:
        | { mode: 'create'; input: AccountInput; key: string }
        | { mode: 'update'; id: string; version: number; patch: Partial<AccountInput> },
    ) =>
      args.mode === 'create'
        ? accountsApi.create(args.input, args.key)
        : accountsApi.update(args.id, args.version, args.patch),
    onSuccess: invalidate,
  })
}

export function useDeleteAccount() {
  const invalidate = useInvalidate(accKeys.accounts())
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      accountsApi.remove(id, version),
    onSuccess: invalidate,
  })
}

// --- Fiscal years ---------------------------------------------------------------------------

export function useFiscalYears(enabled = true) {
  return useQuery({
    queryKey: accKeys.fiscalYears(),
    queryFn: ({ signal }) => fiscalYearsApi.all(signal),
    enabled,
  })
}

export function useCreateFiscalYear() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ input, key }: { input: FiscalYearInput; key: string }) =>
      fiscalYearsApi.create(input, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accKeys.fiscalYears() })
      void qc.invalidateQueries({ queryKey: accKeys.periods() })
    },
  })
}

export function useUpdateFiscalYear() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      version,
      patch,
    }: {
      id: string
      version: number
      patch: Partial<FiscalYearInput>
    }) => fiscalYearsApi.update(id, version, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accKeys.fiscalYears() })
      void qc.invalidateQueries({ queryKey: accKeys.periods() })
    },
  })
}

export function useYearTransition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      args:
        | { action: 'close'; year: FiscalYear; key: string }
        | { action: 'reopen'; year: FiscalYear; reason: string; key: string },
    ) =>
      args.action === 'close'
        ? fiscalYearsApi.close(args.year, args.key)
        : fiscalYearsApi.reopen(args.year, args.reason, args.key),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: accKeys.fiscalYears() })
      void qc.invalidateQueries({ queryKey: accKeys.periods() })
    },
  })
}

export function useClosingPreview(id: string | null) {
  return useQuery({
    queryKey: accKeys.closingPreview(id ?? ''),
    queryFn: ({ signal }) => fiscalYearsApi.closingPreview(id ?? '', signal),
    enabled: Boolean(id),
    retry: false,
  })
}

// --- Periods --------------------------------------------------------------------------------

export function usePeriods(fiscalYearId: string | null) {
  return useQuery({
    queryKey: accKeys.periods(fiscalYearId ?? ''),
    queryFn: ({ signal }) => periodsApi.forYear(fiscalYearId ?? '', signal),
    enabled: Boolean(fiscalYearId),
  })
}

export function usePeriodTransition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      period,
      action,
      reason,
    }: {
      period: AccountingPeriod
      action: PeriodAction
      reason: string | null
    }) => periodsApi.transition(period, action, reason),
    onSettled: () => qc.invalidateQueries({ queryKey: accKeys.periods() }),
  })
}

// --- Determination rules --------------------------------------------------------------------

export function useRules() {
  return useQuery({
    queryKey: accKeys.rules(),
    queryFn: ({ signal }) => rulesApi.all(signal),
  })
}

export function useSaveRule() {
  const invalidate = useInvalidate(accKeys.rules())
  return useMutation({
    mutationFn: (
      args:
        | { mode: 'create'; input: DeterminationRuleInput; key: string }
        | {
            mode: 'update'
            id: string
            version: number
            patch: Partial<DeterminationRuleInput>
          },
    ) =>
      args.mode === 'create'
        ? rulesApi.create(args.input, args.key)
        : rulesApi.update(args.id, args.version, args.patch),
    onSuccess: invalidate,
  })
}

export function useDeleteRule() {
  const invalidate = useInvalidate(accKeys.rules())
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => rulesApi.remove(id, version),
    onSuccess: invalidate,
  })
}
