import type { FieldError } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { PASSWORD_MIN } from '../schemas/login'

/**
 * Client rules carry i18n keys; server errors (type "server") carry ready, localized text.
 */
export function useFieldError() {
  const { t } = useTranslation()
  return (error: FieldError | undefined): string | undefined => {
    if (!error?.message) return undefined
    if (error.type === 'server') return error.message
    return t(error.message as 'auth.validation.emailRequired', { count: PASSWORD_MIN })
  }
}
