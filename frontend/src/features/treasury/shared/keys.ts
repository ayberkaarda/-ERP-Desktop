import type { QueryClient } from '@tanstack/react-query'
import { createKeyStore } from '@/features/sales/shared/lib/idempotency'
import { useCompanyStore } from '@/stores/company'

export const activeCompany = () => useCompanyStore.getState().activeCompanyId ?? 'none'
export const treasuryKey = (company: string, ...parts: unknown[]) =>
  ['treasury', company, ...parts] as const
export const submissionKeys = createKeyStore()
export function invalidateTreasury(client: QueryClient, company: string) {
  for (const queryKey of [
    ['treasury', company],
    ['sales', company],
    ['purchasing', company],
    ['parties', company],
    ['accounting-journal', company],
    ['accounting', company],
  ]) {
    void client.invalidateQueries({ queryKey })
  }
}
