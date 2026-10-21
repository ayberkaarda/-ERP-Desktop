import { FlaskConical, Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { FieldShell } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '../../shared/components'
import { errorMessage } from '../../shared/errors'
import { useAccT } from '../../shared/i18n'
import { useTestDetermination } from '../../shared/queries'
import { CONDITION_KEYS, type DeterminationTestResult } from '../../shared/types'

interface TestPanelProps {
  events: readonly string[]
  initialEvent?: string
  /** Highlights the matched rule in the table. */
  onResult: (result: DeterminationTestResult | null) => void
}

/** Resolves an event + context through POST /account-determination/test without posting. */
export function TestPanel({ events, initialEvent, onResult }: TestPanelProps) {
  const t = useAccT()
  const headingId = useId()
  const [eventKey, setEventKey] = useState(initialEvent ?? events[0] ?? '')
  const [context, setContext] = useState<Record<string, string>>({})
  const test = useTestDetermination()
  const result = test.data

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const ctx = Object.fromEntries(
      Object.entries(context)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v !== ''),
    )
    test.mutate(
      { eventKey, context: ctx },
      { onSuccess: (r) => onResult(r), onError: () => onResult(null) },
    )
  }

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-md border border-border bg-surface p-4"
    >
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="size-4" aria-hidden="true" />
        {t('determination.test.title')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('determination.test.body')}</p>
      <form className="space-y-3" onSubmit={submit} aria-labelledby={headingId}>
        <FieldShell label={t('determination.fields.event')} required>
          {(control) => (
            <NativeSelect
              {...control}
              value={eventKey}
              options={events.map((e) => ({ value: e, label: e }))}
              onChange={(e) => setEventKey(e.target.value)}
            />
          )}
        </FieldShell>
        {CONDITION_KEYS.map((key) => (
          <FieldShell key={key} label={t(`determination.conditionKeys.${key}`)}>
            {(control) => (
              <Input
                {...control}
                value={context[key] ?? ''}
                autoComplete="off"
                onChange={(e) => setContext((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            )}
          </FieldShell>
        ))}
        <Button type="submit" disabled={!eventKey || test.isPending} className="w-full">
          {test.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t('determination.test.run')}
        </Button>
      </form>
      <div aria-live="polite">
        {test.isError && (
          <p
            role="alert"
            className="rounded-md bg-danger-soft p-3 text-sm text-danger-soft-foreground"
          >
            {errorMessage(test.error, t('determination.test.failed'))}
          </p>
        )}
        {result && (
          <div className="space-y-1 rounded-md bg-success-soft p-3 text-sm text-success-soft-foreground">
            <p className="font-semibold">{t('determination.test.resolved')}</p>
            <p>
              <span className="font-code">{result.account?.code ?? result.account_id}</span>{' '}
              {result.account?.name}
            </p>
            <div className="flex flex-wrap gap-1">
              <Badge tone={result.source === 'default' ? 'neutral' : 'primary'}>
                {result.source === 'default'
                  ? t('determination.test.byDefault')
                  : t('determination.test.byRule')}
              </Badge>
              {result.side && <Badge>{t(`accounts.side.${result.side}`)}</Badge>}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
