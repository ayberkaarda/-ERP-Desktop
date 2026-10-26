import { useTranslation } from 'react-i18next'

// Registered with the other namespaces in src/lib/i18n (typed via i18next.d.ts).
export const ACCOUNTING_NS = 'accounting'

export type AccT = (key: string, options?: Record<string, unknown>) => string

/**
 * Translator for the `accounting` namespace. Keys are often built from values
 * (`accounts.types.${type}`), so the loose signature stays; i18n:check guards key parity.
 */
export function useAccT(): AccT {
  const { t } = useTranslation(ACCOUNTING_NS)
  return t as unknown as AccT
}
