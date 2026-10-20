import { AlertCircle } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useFormContext, type FieldValues } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import {
  partitionServerErrors,
  readServerError,
  type ApplyServerErrorsOptions,
} from '@/lib/forms/serverErrors'
import { cn } from '@/lib/utils'

interface FormErrorSummaryProps extends ApplyServerErrorsOptions {
  /** The rejected mutation's error (ApiError or an `{errors:{...}}` body); null hides the summary. */
  error: unknown
  /** Translated labels for form paths, used in the list. */
  fieldLabels?: Record<string, string>
  title?: string
  className?: string
}

/**
 * Attaches server `errors.fields` to the matching form fields and lists them in one alert, with
 * links that move focus to each field. Errors with no matching field are listed as text.
 */
export function FormErrorSummary({
  error,
  fieldLabels = {},
  title,
  className,
  mapField,
  knownFields,
}: FormErrorSummaryProps) {
  const { t } = useTranslation('common')
  const { setError, setFocus } = useFormContext<FieldValues>()
  const ref = useRef<HTMLDivElement>(null)
  const server = useMemo(() => readServerError(error), [error])
  const parts = useMemo(
    () => (server ? partitionServerErrors(server, { mapField, knownFields }) : null),
    // Options are config; a new mapField closure each render must not re-apply errors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server],
  )

  useEffect(() => {
    if (!parts) return
    for (const { field, message } of parts.mapped) {
      setError(field, { type: 'server', message })
    }
    ref.current?.focus()
  }, [parts, setError])

  if (!server || !parts) return null
  const label = (field: string) => fieldLabels[field] ?? field

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cn(
        'rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{title ?? t('form.errorSummaryTitle')}</p>
          <p>{server.message}</p>
          {(parts.mapped.length > 0 || parts.unmapped.length > 0) && (
            <>
              {parts.mapped.length > 0 && <p>{t('form.errorSummaryBody')}</p>}
              <ul className="list-disc space-y-0.5 pl-5">
                {parts.mapped.map(({ field, message }) => (
                  <li key={field}>
                    <button
                      type="button"
                      className="text-left underline underline-offset-2 hover:no-underline"
                      onClick={() => setFocus(field)}
                    >
                      {label(field)}
                    </button>
                    : {message}
                  </li>
                ))}
                {parts.unmapped.map(({ field, message }) => (
                  <li key={`u-${field}`}>{message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
