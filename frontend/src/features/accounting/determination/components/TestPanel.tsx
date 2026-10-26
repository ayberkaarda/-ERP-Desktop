import { FlaskConical, Loader2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { FieldShell } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '../../shared/components'
import { errorMessage } from '../../shared/errors'
import { useAccT } from '../../shared/i18n'
import { rulesApi } from '../../shared/api'
import {
  TEST_CONTEXT_KEYS,
  type DeterminationRule,
  type DeterminationTestResult,
} from '../../shared/types'

interface TestPanelProps {
  events: readonly string[]
  initialEvent?: string
  /** Loaded rules: a matched rule without conditions is the fallback (default) rule. */
  rules?: readonly DeterminationRule[]
  /** Highlights the matched rule in the table. */
  onResult: (result: DeterminationTestResult | null) => void
}

/** Resolves an event + context through POST /account-determination/test without posting. */
export function TestPanel({ events, initialEvent, rules = [], onResult }: TestPanelProps) {
  const t = useAccT()
  const headingId = useId()
  const [eventKey, setEventKey] = useState(initialEvent ?? events[0] ?? '')
  const [context, setContext] = useState<Record<string, string>>({})
  const [result, setResult] = useState<DeterminationTestResult | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  // Each run and each input change gets a new id; answers for an older id are ignored.
  const runId = useRef(0)

  const invalidate = () => {
    runId.current += 1
    setResult(null)
    setError(null)
    setPending(false)
    onResult(null)
  }

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const ctx = Object.fromEntries(
      Object.entries(context)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v !== ''),
    )
    runId.current += 1
    const mine = runId.current
    setResult(null)
    setError(null)
    setPending(true)
    onResult(null)
    rulesApi.test(eventKey, ctx).then(
      (answer) => {
        if (runId.current !== mine) return
        const matched = rules.find((x) => x.id === answer.rule_id)
        const r: DeterminationTestResult = matched
          ? {
              ...answer,
              source: Object.keys(matched.conditions ?? {}).length > 0 ? 'rule' : 'default',
            }
          : answer
        setResult(r)
        setPending(false)
        onResult(r)
      },
      (err: unknown) => {
        if (runId.current !== mine) return
        setError(err)
        setPending(false)
      },
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
              onChange={(e) => {
                setEventKey(e.target.value)
                invalidate()
              }}
            />
          )}
        </FieldShell>
        {TEST_CONTEXT_KEYS.map((key) => (
          <FieldShell key={key} label={t(`determination.conditionKeys.${key}`)}>
            {(control) => (
              <Input
                {...control}
                value={context[key] ?? ''}
                autoComplete="off"
                onChange={(e) => {
                  const value = e.target.value
                  setContext((prev) => ({ ...prev, [key]: value }))
                  invalidate()
                }}
              />
            )}
          </FieldShell>
        ))}
        <Button type="submit" disabled={!eventKey || pending} className="w-full">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t('determination.test.run')}
        </Button>
      </form>
      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="rounded-md bg-danger-soft p-3 text-sm text-danger-soft-foreground"
          >
            {errorMessage(error, t('determination.test.failed'))}
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
