import { useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/shared/EmptyState'
import { DecimalInput } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, INVALID_DECIMAL } from '@/lib/money'
import { isApiError, platform } from '@/platform'
import { conversionsApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { useConversions, useIdempotencyKey, useUnits } from '../hooks/queries'
import {
  conversionMatrix,
  diffMatrix,
  factorProblem,
  fractionDigits,
  pairKey,
  type MatrixChange,
} from '../lib/conversion'
import { errorMessage, isVersionConflict } from '../lib/errors'
import { VersionConflictAlert } from './VersionConflictAlert'

function changeKey(c: MatrixChange) {
  return c.kind === 'create'
    ? pairKey(c.from, c.to)
    : pairKey(c.conversion.from_unit_id, c.conversion.to_unit_id)
}

/**
 * Unit × unit grid: cell (row A, column B) is "1 A = factor B". Only one direction needs
 * storing; the other shows the implied inverse as a hint. Edits are saved together.
 */
export function ConversionMatrix() {
  const { t } = useTranslation('catalog')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const units = useUnits()
  const conversions = useConversions()
  const idem = useIdempotencyKey()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)

  const active = useMemo(() => (units.data ?? []).filter((u) => u.is_active), [units.data])
  const matrix = useMemo(() => conversionMatrix(conversions.data ?? []), [conversions.data])

  const localErrors = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(edits)) {
      if (value === '') continue
      const problem = value === INVALID_DECIMAL ? 'number' : factorProblem(value)
      if (problem === 'number') out[key] = t('validation.number')
      else if (problem === 'positive') out[key] = t('validation.factorPositive')
      else if (problem) out[key] = t('validation.factorRange')
    }
    return out
  }, [edits, t])

  const changes = useMemo(
    () => diffMatrix(conversions.data ?? [], edits),
    [conversions.data, edits],
  )
  const hasLocalErrors = Object.keys(localErrors).length > 0

  if (units.isPending || conversions.isPending) {
    return <Skeleton className="h-64 w-full" />
  }
  if (units.isError || conversions.isError) {
    return (
      <EmptyState
        title={t('errors.loadFailed')}
        action={
          <Button
            variant="secondary"
            onClick={() => {
              void units.refetch()
              void conversions.refetch()
            }}
          >
            {t('actions.retry')}
          </Button>
        }
      />
    )
  }
  if (active.length < 2) {
    return <EmptyState title={t('conversions.needUnits')} />
  }

  const setCell = (key: string, value: string) => {
    setEdits((prev) => ({ ...prev, [key]: value }))
    setCellErrors((prev) => {
      if (!(key in prev)) return prev
      return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key))
    })
  }

  const reset = () => {
    setEdits({})
    setCellErrors({})
  }

  const reload = async () => {
    setConflict(false)
    reset()
    await queryClient.invalidateQueries({ queryKey: catalogKeys.conversions() })
  }

  const save = async () => {
    if (hasLocalErrors || changes.length === 0) return
    setSaving(true)
    const failed: Record<string, string> = {}
    const done: string[] = []
    let sawConflict = false
    for (const change of changes) {
      const key = changeKey(change)
      try {
        if (change.kind === 'create') {
          const body = { from_unit_id: change.from, to_unit_id: change.to, factor: change.factor }
          await conversionsApi.create(body, idem.current(body))
          idem.reset()
        } else if (change.kind === 'update') {
          await conversionsApi.update(change.conversion.id, {
            factor: change.factor,
            version: change.conversion.version,
          })
        } else {
          await conversionsApi.remove(change.conversion.id)
        }
        done.push(key)
      } catch (e) {
        if (isVersionConflict(e)) sawConflict = true
        const fieldMessage = isApiError(e) ? Object.values(e.fields).flat()[0] : undefined
        failed[key] = fieldMessage ?? errorMessage(e, t('errors.saveFailed'))
      }
    }
    setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !done.includes(k))))
    setCellErrors(failed)
    setConflict(sawConflict)
    setSaving(false)
    await queryClient.invalidateQueries({ queryKey: catalogKeys.conversions() })
    if (Object.keys(failed).length === 0) platform.notify.success(t('toast.saved'))
    else
      platform.notify.error(t('conversions.partialFailure', { count: Object.keys(failed).length }))
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('conversions.help')}</p>
      {conflict && <VersionConflictAlert onReload={() => void reload()} />}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          className="border-separate border-spacing-0 text-table"
          aria-label={t('conversions.title')}
        >
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th
                scope="col"
                className="sticky left-0 h-row border-b border-border bg-surface-sunken px-3 text-left font-medium"
              >
                {t('conversions.fromTo')}
              </th>
              {active.map((u) => (
                <th
                  key={u.id}
                  scope="col"
                  className="h-row border-b border-border px-2 text-right font-medium font-code"
                >
                  {u.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map((from) => (
              <tr key={from.id}>
                <th
                  scope="row"
                  className="sticky left-0 border-b border-border bg-surface px-3 text-left font-medium whitespace-nowrap"
                >
                  <span className="font-code">1 {from.code}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{from.name}</span>
                </th>
                {active.map((to) => {
                  const key = pairKey(from.id, to.id)
                  if (from.id === to.id) {
                    return (
                      <td
                        key={to.id}
                        className="border-b border-border px-3 text-right text-muted-foreground"
                      >
                        <span aria-label={t('conversions.identity')}>1</span>
                      </td>
                    )
                  }
                  const cell = matrix.get(key)
                  const value = key in edits ? (edits[key] ?? '') : (cell?.conversion?.factor ?? '')
                  const error = localErrors[key] ?? cellErrors[key]
                  const errorId = `conv-${key}-error`
                  const placeholder = cell?.implied
                    ? `≈ ${formatDecimalDisplay(cell.implied, { locale, minFraction: 0, maxFraction: Math.max(6, fractionDigits(cell.implied)) })}`
                    : undefined
                  return (
                    <td key={to.id} className="min-w-32 border-b border-border p-1 align-top">
                      <DecimalInput
                        scale={6}
                        displayMinFraction={0}
                        value={value}
                        onChange={(v) => setCell(key, v)}
                        placeholder={placeholder}
                        aria-label={t('conversions.cellLabel', { from: from.code, to: to.code })}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        className="h-control-sm text-right"
                        disabled={saving}
                      />
                      {error && (
                        <p id={errorId} className="mt-0.5 max-w-40 text-2xs text-danger">
                          {error}
                        </p>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground" role="status">
          {changes.length > 0
            ? t('conversions.pending', { count: changes.length })
            : t('conversions.noChanges')}
        </span>
        <Button
          variant="secondary"
          onClick={reset}
          disabled={saving || Object.keys(edits).length === 0}
        >
          <RotateCcw aria-hidden="true" />
          {t('actions.discard')}
        </Button>
        <Button
          onClick={() => void save()}
          disabled={saving || hasLocalErrors || changes.length === 0}
        >
          {saving ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
          {t('conversions.save')}
        </Button>
      </div>
    </div>
  )
}
