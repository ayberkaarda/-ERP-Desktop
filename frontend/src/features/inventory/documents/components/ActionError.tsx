import { CircleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readServerError } from '@/lib/forms'
import { errorMessage } from '../lib/errors'

/** A failed action outside a form: the server's message and any field messages. */
export function ActionError({ error }: { error: unknown }) {
  const { t } = useTranslation('inventoryDocs')
  if (!error) return null
  const fields = Object.values(readServerError(error)?.fields ?? {}).flat()
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">{errorMessage(error, t('errors.generic'))}</p>
        {fields.length > 0 && (
          <ul className="list-disc pl-4 text-xs">
            {[...new Set(fields)].slice(0, 10).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
