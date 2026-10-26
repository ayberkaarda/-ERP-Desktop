import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermission } from '@/lib/permissions'
import { useCompanyStore } from '@/stores/company'
import type labels from '@/lib/i18n/locales/treasury/tr.json'
import { treasuryApi } from './api'
import { activeCompany, invalidateTreasury, submissionKeys, treasuryKey } from './keys'
import type { Area, TreasuryRecord } from './types'
export function useTreasuryT() {
  const { t } = useTranslation('treasury')
  return (key: string, options?: Record<string, unknown>): string =>
    t(key as keyof typeof labels, options)
}
export function useTreasuryCompany() {
  return useCompanyStore((s) => s.activeCompanyId) ?? 'none'
}
export function useAccounts() {
  const company = useTreasuryCompany()
  const allowed = usePermission('treasury.accounts.view')
  return useQuery({
    queryKey: treasuryKey(company, 'account-options'),
    queryFn: ({ signal }) => treasuryApi.accounts(signal),
    enabled: allowed,
  })
}
export function useRecord<T extends TreasuryRecord>(area: Area, id: string | undefined) {
  const company = useTreasuryCompany()
  return useQuery({
    queryKey: treasuryKey(company, area, id),
    queryFn: ({ signal }) => treasuryApi.get<T>(area, id ?? '', signal),
    enabled: Boolean(id && id !== 'new'),
  })
}
export function useTreasuryMutation<T>(
  action: string,
  send: (body: Record<string, unknown>, key: string) => Promise<T>,
  onSaved: (record: T) => void,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ body, company }: { body: Record<string, unknown>; company: string }) => {
      if (activeCompany() !== company) throw new Error('Company changed')
      const payload = { company, action, body }
      const result = await send(body, submissionKeys.keyFor(payload))
      submissionKeys.release(payload)
      return result
    },
    onSuccess: (record, { company }) => {
      invalidateTreasury(client, company)
      if (activeCompany() === company) onSaved(record)
    },
  })
}
export function useFormValue<T extends object>(initial: T) {
  const [value, setValue] = useState(initial)
  return [
    value,
    <K extends keyof T>(key: K, v: T[K]) => setValue((old) => ({ ...old, [key]: v })),
    setValue,
  ] as const
}
