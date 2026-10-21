import { useQueryClient } from '@tanstack/react-query'
import { ListOrdered, Loader2, ScanBarcode } from 'lucide-react'
import { useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DecimalInput } from '@/components/shared/form'
import { DocumentLinesEditor, type LineColumn } from '@/components/shared/lines/DocumentLinesEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIsoDate, useIntlLocale } from '@/lib/datetime'
import { platform } from '@/platform'
import { ItemCombobox, UnitSelect } from '@/features/catalog'
import { errorMessage } from '../../invoices/kit/http'
import { salesDocsKeys } from '../../invoices/kit/keys'
import { qty } from '../../invoices/kit/money'
import { MAX_LINES } from '../../invoices/kit/types'
import { deliveriesApi } from '../api'
import { fefoRequestFor, planFefo } from '../lib/fefo'
import {
  emptyLine,
  exceedsRemaining,
  isSkipped,
  parseSerials,
  type DeliveryLineValues,
  type DeliveryValues,
} from '../lib/lines'
import { SerialsDialog } from './SerialsDialog'

interface DeliveryLinesGridProps {
  disabled: boolean
  /** Lines come from an order: items are fixed and no free lines are added. */
  fromOrder: boolean
}

/** Delivery lines: quantity against the order's remaining, lot with FEFO suggestion, serials. */
export function DeliveryLinesGrid({ disabled, fromOrder }: DeliveryLinesGridProps) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const form = useFormContext<DeliveryValues>()
  const lines = useWatch({ control: form.control, name: 'lines' })
  const [serialsFor, setSerialsFor] = useState<number | null>(null)
  const [fefoBusy, setFefoBusy] = useState<number | null>(null)
  const showLot = lines.some((l) => l.tracking === 'lot') || !fromOrder
  const showSerials = lines.some((l) => l.tracking === 'serial') || !fromOrder

  const set = (index: number, patch: Partial<DeliveryLineValues>) => {
    for (const [key, value] of Object.entries(patch)) {
      form.setValue(`lines.${index}.${key as keyof DeliveryLineValues}`, value, {
        shouldDirty: true,
      })
    }
  }

  /** Splits the line over lots by first expiry (expired lots are left out). */
  const suggestFefo = async (index: number) => {
    const current = form.getValues('lines')
    const header = form.getValues('warehouseId')
    const line = current[index]
    const req = fefoRequestFor(current, index, header)
    const wh = line && line.warehouseId !== '' ? line.warehouseId : header
    if (!line || !req || !wh || isSkipped(line)) return
    setFefoBusy(index)
    try {
      const lots = await queryClient.query({
        queryKey: salesDocsKeys.lots(line.itemId, wh),
        queryFn: ({ signal }) => deliveriesApi.lots(line.itemId, wh, signal),
        staleTime: 30_000,
      })
      // Re-read the form: the user may have edited, removed or moved rows meanwhile.
      const plan = planFefo(
        form.getValues('lines'),
        form.getValues('warehouseId'),
        req,
        lots,
        toIsoDate(new Date()),
      )
      if (plan.kind === 'stale') {
        platform.notify.warning(t('fefo.stale'))
        return
      }
      if (plan.kind === 'tooMany') {
        platform.notify.warning(t('lines.maxReached', { max: MAX_LINES }))
        return
      }
      if (plan.kind === 'none') {
        platform.notify.warning(t('fefo.none'))
        return
      }
      const { result } = plan
      form.setValue('lines', plan.lines, { shouldDirty: true, shouldValidate: false })
      if (result.shortage !== '0') {
        platform.notify.warning(t('fefo.shortage', { quantity: qty(result.shortage, locale) }))
      } else {
        platform.notify.success(t('fefo.applied', { count: result.allocations.length }))
      }
      if (result.skippedExpired > 0) {
        platform.notify.info(t('fefo.skippedExpired', { count: result.skippedExpired }))
      }
    } catch (error) {
      platform.notify.error(errorMessage(error, t('fefo.failed')))
    } finally {
      setFefoBusy(null)
    }
  }

  const columns: LineColumn<DeliveryLineValues>[] = [
    {
      id: 'itemId',
      header: t('fields.item'),
      width: '20rem',
      readOnly: fromOrder,
      render: (ctx) =>
        ctx.line.sourceLineId ? (
          <span {...ctx.cell} ref={ctx.ref} tabIndex={-1} className="block px-1 pt-1.5 text-sm">
            {ctx.line.itemLabel}
          </span>
        ) : (
          <ItemCombobox
            {...ctx.cell}
            ref={ctx.ref}
            value={ctx.value || null}
            type="stock"
            disabled={ctx.disabled}
            className="min-w-60"
            onBlur={ctx.onBlur}
            onChange={(id, item) => {
              ctx.setValue(id ?? '')
              set(ctx.index, {
                itemLabel: item ? `${item.code} · ${item.name}` : '',
                tracking: item?.tracking ?? 'none',
                unitId: item?.base_unit_id ?? '',
                unitCode: item?.base_unit?.code ?? '',
                lotNo: '',
                serials: '',
              })
            }}
          />
        ),
    },
    {
      id: 'quantity',
      header: t('fields.quantity'),
      width: '10rem',
      align: 'right',
      render: (ctx) => (
        <div>
          <DecimalInput
            {...ctx.cell}
            ref={ctx.ref}
            scale={6}
            displayMinFraction={0}
            value={ctx.value}
            disabled={ctx.disabled}
            locale={locale}
            className="h-control-sm"
            onChange={ctx.setValue}
            onBlur={ctx.onBlur}
          />
          {ctx.line.sourceLineId && ctx.line.remaining !== '' && (
            <p
              className={
                exceedsRemaining(ctx.line, lines)
                  ? 'px-1 pt-0.5 text-right text-2xs text-warning-soft-foreground'
                  : 'px-1 pt-0.5 text-right text-2xs text-muted-foreground'
              }
              data-testid={`remaining-${ctx.index}`}
            >
              {exceedsRemaining(ctx.line, lines)
                ? t('delivery.overRemaining', { quantity: qty(ctx.line.remaining, locale) })
                : t('delivery.remaining', { quantity: qty(ctx.line.remaining, locale) })}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'unitId',
      header: t('fields.unit'),
      width: '7rem',
      readOnly: fromOrder,
      render: (ctx) =>
        ctx.line.sourceLineId || !ctx.line.itemId ? (
          <span className="block px-1 pt-1.5 text-sm">{ctx.line.unitCode}</span>
        ) : (
          <UnitSelect
            {...ctx.cell}
            ref={ctx.ref}
            value={ctx.value || null}
            disabled={ctx.disabled}
            onChange={(v) => ctx.setValue(v ?? '')}
          />
        ),
    },
  ]
  if (showLot) {
    columns.push({
      id: 'lotNo',
      header: t('fields.lot'),
      width: '14rem',
      render: (ctx) =>
        ctx.line.tracking === 'lot' ? (
          <div className="flex items-center gap-1">
            <Input
              {...ctx.cell}
              ref={ctx.ref}
              value={ctx.value}
              maxLength={100}
              disabled={ctx.disabled}
              className="h-control-sm font-code"
              onChange={(e) => ctx.setValue(e.target.value)}
              onBlur={ctx.onBlur}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              tabIndex={-1}
              disabled={ctx.disabled || fefoBusy !== null || isSkipped(ctx.line)}
              aria-label={t('fefo.suggest', { index: ctx.index + 1 })}
              title={t('fefo.hint')}
              onClick={() => void suggestFefo(ctx.index)}
            >
              {fefoBusy === ctx.index ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <ListOrdered aria-hidden="true" />
              )}
            </Button>
          </div>
        ) : (
          <span className="block px-1 pt-1.5 text-xs text-muted-foreground">—</span>
        ),
    })
  }
  if (showSerials) {
    columns.push({
      id: 'serials',
      header: t('fields.serials'),
      width: '9rem',
      render: (ctx) =>
        ctx.line.tracking === 'serial' ? (
          <Button
            {...ctx.cell}
            ref={ctx.ref}
            type="button"
            variant="secondary"
            size="sm"
            disabled={ctx.disabled}
            onClick={() => setSerialsFor(ctx.index)}
          >
            <ScanBarcode aria-hidden="true" />
            {t('delivery.serialButton', {
              count: parseSerials(ctx.value).length,
              quantity: qty(ctx.line.quantity, locale) || '0',
            })}
          </Button>
        ) : (
          <span className="block px-1 pt-1.5 text-xs text-muted-foreground">—</span>
        ),
    })
  }

  const target = serialsFor === null ? undefined : lines[serialsFor]
  return (
    <>
      <DocumentLinesEditor<DeliveryValues, DeliveryLineValues>
        name="lines"
        label={t('delivery.lines')}
        columns={columns}
        disabled={disabled}
        newLine={emptyLine}
        footer={(rows) => (
          <span
            className="text-xs text-muted-foreground tabular-nums"
            data-testid="delivery-footer"
          >
            {t('delivery.footer', { count: rows.filter((r) => !isSkipped(r)).length })}
          </span>
        )}
      />
      {fromOrder && <p className="text-xs text-muted-foreground">{t('delivery.partialHint')}</p>}
      {target && serialsFor !== null && (
        <SerialsDialog
          open
          onOpenChange={(open) => !open && setSerialsFor(null)}
          item={target.itemLabel}
          quantity={qty(target.quantity, locale) || '0'}
          value={target.serials}
          onSave={(text) => set(serialsFor, { serials: text })}
        />
      )}
    </>
  )
}
