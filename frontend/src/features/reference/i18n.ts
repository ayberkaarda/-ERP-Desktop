import { useTranslation } from 'react-i18next'

// The `reference` namespace is registered with the others in src/lib/i18n (typed via i18next.d.ts).
export const REFERENCE_NS = 'reference'

export type RefT = (key: string, options?: Record<string, unknown>) => string

/**
 * Translator for the `reference` namespace. Pages build many keys dynamically
 * (`types.${value}`), so the loose signature stays; i18n:check guards key parity.
 */
export function useRefT(): RefT {
  const { t } = useTranslation(REFERENCE_NS)
  return t as unknown as RefT
}
