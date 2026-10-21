import { Wand2 } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DecimalInput } from '@/components/shared/form'
import {
  DocumentLinesEditor,
  type LineCellContext,
  type LineColumn,
} from '@/components/shared/lines/DocumentLinesEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { platform } from '@/platform'
import { amountOf, balancingAmount, baseAmount, sameAmount } from '../lib/balance'
import { emptyLine, lineColumns, type EntryValues, type LineValues } from '../lib/lines'
import { MAX_LINES } from '../types'
import { JournalAccountPicker, RefPicker } from './pickers'

interface JournalLinesGridProps {
  disabled?: boolean
  showAllDimensions?: boolean
}

type Side = 'debit' | 'credit'
const other = (side: Side): Side => (side === 'debit' ? 'credit' : 'debit')

/** A cell that has nothing to edit for this line but must stay in the Enter/Tab flow. */
function NotApplicable({ ctx }: { ctx: LineCellContext<LineValues> }) {
  const { t } = useTranslation('accountingJournal')
  return (
    <Input
      {...ctx.cell}
      readOnly
      value=""
      placeholder="—"
      title={t('lines.notApplicable')}
      className="h-control-sm bg-surface-sunken text-center"
    />
  )
}

/**
 * Debit/credit grid on the shared DocumentLinesEditor. On top of its Enter/Tab flow: an amount
 * on one side clears the other, Enter after a debit skips the credit cell, F9 (or "=") fills
 * the amount that balances the entry, and dimension / currency columns follow account flags.
 */
export function JournalLinesGrid({
  disabled = false,
  showAllDimensions = false,
}: JournalLinesGridProps) {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  const { control, setValue, getValues } = useFormContext<EntryValues>()
  const lines = useWatch({ control, name: 'lines' })
  const containerRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<{ row: number; col: number } | null>(null)
  const cols = lineColumns(lines, showAllDimensions)

  const set = (path: `lines.${number}.${keyof LineValues}`, value: unknown) =>
    setValue(path, value as never, { shouldDirty: true, shouldValidate: false })

  const focusCell = (row: number, col: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-line-row="${row}"][data-line-col="${col}"]`,
    )
    if (!el) return false
    el.focus()
    if (el instanceof HTMLInputElement) el.select()
    return true
  }

  useEffect(() => {
    const p = pendingFocus.current
    if (p && focusCell(p.row, p.col)) pendingFocus.current = null
  })

  const appendLine = (focusCol: number) => {
    const current = getValues('lines')
    if (current.length >= MAX_LINES) {
      platform.notify.warning(t('lines.maxReached', { max: MAX_LINES }))
      return
    }
    pendingFocus.current = { row: current.length, col: focusCol }
    setValue('lines', [...current, emptyLine()], { shouldDirty: true })
  }

  const setAmount = (index: number, side: Side, value: string) => {
    set(`lines.${index}.${side}`, value)
    // One line carries either a debit or a credit, never both.
    if (!amountOf(value).isZero() && getValues(`lines.${index}.${other(side)}`) !== '') {
      set(`lines.${index}.${other(side)}`, '')
    }
  }

  const fillBalance = (index: number) => {
    const fill = balancingAmount(getValues('lines'), index)
    if (!fill) return
    set(`lines.${index}.${fill.side}`, fill.amount)
    set(`lines.${index}.${other(fill.side)}`, '')
  }

  const columns: LineColumn<LineValues>[] = []
  const indexOf = (id: string) => columns.findIndex((c) => c.id === id)

  const amountKeys =
    (side: Side) => (ctx: LineCellContext<LineValues>) => (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'F9' || e.key === '=') {
        e.preventDefault()
        fillBalance(ctx.index)
        return
      }
      if (
        side === 'debit' &&
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !amountOf(getValues(`lines.${ctx.index}.debit`)).isZero()
      ) {
        // A debit line has no credit: jump past the credit cell.
        e.preventDefault()
        const after = columns.findIndex((c, i) => i > indexOf('credit') && !c.readOnly)
        const first = indexOf('accountId')
        if (after >= 0) focusCell(ctx.index, after)
        else if (ctx.index + 1 < getValues('lines').length) focusCell(ctx.index + 1, first)
        else appendLine(first)
      }
    }

  const amountColumn = (side: Side): LineColumn<LineValues> => ({
    id: side,
    header: t(`lines.${side}`),
    width: '9.5rem',
    align: 'right',
    render: (ctx) => (
      <DecimalInput
        {...ctx.cell}
        ref={ctx.ref}
        scale={2}
        value={ctx.value}
        disabled={ctx.disabled}
        locale={locale}
        className="h-control-sm"
        onChange={(v) => setAmount(ctx.index, side, v)}
        onBlur={ctx.onBlur}
        onKeyDown={amountKeys(side)(ctx)}
      />
    ),
  })

  columns.push(
    {
      id: 'accountId',
      header: t('lines.account'),
      width: '17rem',
      render: (ctx) => (
        <JournalAccountPicker
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value}
          account={ctx.line.account}
          disabled={ctx.disabled}
          className="min-w-56"
          onBlur={ctx.onBlur}
          onChange={(id, account) => {
            ctx.setValue(id)
            set(`lines.${ctx.index}.account`, account)
          }}
        />
      ),
    },
    {
      id: 'description',
      header: t('lines.description'),
      width: '14rem',
      render: (ctx) => (
        <Input
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value}
          disabled={ctx.disabled}
          maxLength={500}
          className="h-control-sm"
          onChange={(e) => ctx.setValue(e.target.value)}
          onBlur={ctx.onBlur}
        />
      ),
    },
    amountColumn('debit'),
    amountColumn('credit'),
  )

  if (cols.fx) {
    columns.push(
      {
        id: 'fxAmount',
        header: t('lines.fxAmount'),
        width: '9.5rem',
        align: 'right',
        render: (ctx) =>
          ctx.line.account?.currency_code ? (
            <DecimalInput
              {...ctx.cell}
              ref={ctx.ref}
              scale={2}
              value={ctx.value}
              disabled={ctx.disabled}
              locale={locale}
              suffix={ctx.line.account.currency_code}
              aria-required
              className="h-control-sm"
              onChange={ctx.setValue}
              onBlur={ctx.onBlur}
            />
          ) : (
            <NotApplicable ctx={ctx} />
          ),
      },
      {
        id: 'fxRate',
        header: t('lines.fxRate'),
        width: '8.5rem',
        align: 'right',
        render: (ctx) =>
          ctx.line.account?.currency_code ? (
            <DecimalInput
              {...ctx.cell}
              ref={ctx.ref}
              scale={6}
              displayMinFraction={4}
              value={ctx.value}
              disabled={ctx.disabled}
              locale={locale}
              aria-required
              className="h-control-sm"
              onChange={ctx.setValue}
              onBlur={ctx.onBlur}
            />
          ) : (
            <NotApplicable ctx={ctx} />
          ),
      },
      {
        id: 'basePreview',
        header: t('lines.baseAmount'),
        width: '9rem',
        align: 'right',
        readOnly: true,
        render: ({ line, index }) => {
          if (!line.account?.currency_code) return <span className="text-muted-foreground">—</span>
          const base = baseAmount(line.fxAmount, line.fxRate)
          if (!base) return <span className="text-muted-foreground">—</span>
          const side: Side = amountOf(line.credit).greaterThan(0) ? 'credit' : 'debit'
          const matches = sameAmount(line[side], base)
          return (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <span data-testid={`base-preview-${index}`}>
                {formatDecimalDisplay(base, { locale })}
              </span>
              {!matches && !disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('lines.applyBase', { index: index + 1 })}
                  title={t('lines.applyBase', { index: index + 1 })}
                  onClick={() => setAmount(index, side, base)}
                >
                  <Wand2 aria-hidden="true" />
                </Button>
              )}
            </span>
          )
        },
      },
    )
  }

  const dimension = (
    id: 'partyId' | 'costCenterId' | 'projectId',
    resource: 'parties' | 'cost-centers' | 'projects',
    recordKey: 'party' | 'costCenter' | 'project',
    flag: 'requires_party' | 'requires_cost_center' | 'requires_project',
  ): LineColumn<LineValues> => ({
    id,
    header: t(`lines.${recordKey}`),
    width: '13rem',
    render: (ctx) => {
      const required = Boolean(ctx.line.account?.[flag])
      return (
        <RefPicker
          {...ctx.cell}
          ref={ctx.ref}
          resource={resource}
          value={ctx.value}
          record={ctx.line[recordKey]}
          disabled={ctx.disabled}
          aria-required={required || undefined}
          placeholder={required ? t('lines.required') : t('lines.optional')}
          className="min-w-44"
          clearable
          onBlur={ctx.onBlur}
          onChange={(value, record) => {
            ctx.setValue(value)
            set(`lines.${ctx.index}.${recordKey}`, record)
          }}
        />
      )
    },
  })

  if (cols.party) columns.push(dimension('partyId', 'parties', 'party', 'requires_party'))
  if (cols.costCenter)
    columns.push(dimension('costCenterId', 'cost-centers', 'costCenter', 'requires_cost_center'))
  if (cols.project) columns.push(dimension('projectId', 'projects', 'project', 'requires_project'))

  return (
    <div ref={containerRef} className="space-y-2">
      <DocumentLinesEditor<EntryValues, LineValues>
        name="lines"
        label={t('lines.title')}
        columns={columns}
        newLine={emptyLine}
        minLines={1}
        disabled={disabled}
        footer={(rows) => (
          <p className="text-xs text-muted-foreground">
            {t('lines.count', { count: rows.length, max: MAX_LINES })} · {t('lines.keys')}
          </p>
        )}
      />
    </div>
  )
}
