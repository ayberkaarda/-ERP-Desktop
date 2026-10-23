import { ListPlus, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DateInput, DecimalInput } from '@/components/shared/form'
import { DocumentLinesEditor, type LineColumn } from '@/components/shared/lines/DocumentLinesEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ItemCombobox, UnitSelect } from '@/features/catalog'
import { TaxCodeSelect } from '@/features/reference'
import { dec, isDecimal, qty } from '@/features/sales/invoices/kit/money'
import { useIntlLocale } from '@/lib/datetime'
import {
  emptyReceiptLine,
  parseSerials,
  serialsNeeded,
  receivedOnForm,
  splitLine,
  type ReceiptLineValues,
  type ReceiptValues,
} from '../lib/lines'
import { SerialsDialog } from './SerialsDialog'

interface ReceiptLinesGridProps {
  disabled: boolean
  /** Direct receipts edit item lines; order receipts only quantities and tracking. */
  direct: boolean
}

/**
 * Received lines: quantity against what is still open on the order line, lot number, expiry
 * date and serial numbers per the item's tracking; a line splits into several lots.
 */
export function ReceiptLinesGrid({ disabled, direct }: ReceiptLinesGridProps) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const form = useFormContext<ReceiptValues>()
  const lines = useWatch({ control: form.control, name: 'lines' })
  const documentDate = useWatch({ control: form.control, name: 'documentDate' })
  const [serialsFor, setSerialsFor] = useState<number | null>(null)
  const serialLine = serialsFor === null ? undefined : lines[serialsFor]

  const set = (index: number, patch: Partial<ReceiptLineValues>) => {
    for (const [key, value] of Object.entries(patch)) {
      form.setValue(`lines.${index}.${key as keyof ReceiptLineValues}`, value, {
        shouldDirty: true,
      })
    }
  }

  const columns: LineColumn<ReceiptLineValues>[] = [
    {
      id: 'itemId',
      header: t('fields.item'),
      width: '16rem',
      render: (ctx) =>
        direct && !ctx.line.orderLineId ? (
          <ItemCombobox
            {...ctx.cell}
            ref={ctx.ref}
            value={ctx.value || null}
            disabled={ctx.disabled}
            className="min-w-56"
            onBlur={ctx.onBlur}
            onChange={(id, item) => {
              ctx.setValue(id ?? '')
              set(ctx.index, {
                itemLabel: item ? `${item.code} · ${item.name}` : '',
                tracking: item?.tracking ?? 'none',
                hasExpiry: item?.has_expiry ?? false,
                unitId: item?.base_unit_id ?? '',
                taxCodeId: item?.purchase_tax_code_id ?? item?.default_tax_code_id ?? '',
              })
            }}
          />
        ) : (
          <span className="block min-w-48 truncate" title={ctx.line.itemLabel}>
            {ctx.line.itemLabel}
          </span>
        ),
    },
    {
      id: 'quantity',
      header: t('fields.quantity'),
      width: '9rem',
      align: 'right',
      render: (ctx) => {
        const over =
          ctx.line.orderLineId !== '' &&
          isDecimal(ctx.line.remaining) &&
          receivedOnForm(lines, ctx.line.orderLineId).greaterThan(dec(ctx.line.remaining))
        return (
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
            {ctx.line.orderLineId && ctx.line.remaining && (
              <p
                className={
                  over
                    ? 'px-1 pt-0.5 text-right text-2xs text-warning-soft-foreground'
                    : 'px-1 pt-0.5 text-right text-2xs text-muted-foreground'
                }
                data-testid={`remaining-${ctx.index}`}
              >
                {over
                  ? t('receipt.overRemaining', { remaining: qty(ctx.line.remaining, locale) })
                  : t('receipt.remaining', { remaining: qty(ctx.line.remaining, locale) })}
              </p>
            )}
          </div>
        )
      },
    },
    {
      id: 'unitId',
      header: t('fields.unit'),
      width: '7rem',
      render: (ctx) =>
        direct && !ctx.line.orderLineId ? (
          <UnitSelect
            {...ctx.cell}
            ref={ctx.ref}
            value={ctx.value || null}
            disabled={ctx.disabled}
            onBlur={ctx.onBlur}
            onChange={(v) => ctx.setValue(v ?? '')}
          />
        ) : (
          <span>{ctx.line.unitCode}</span>
        ),
    },
    ...(direct
      ? ([
          {
            id: 'unitPrice',
            header: t('fields.unitPrice'),
            width: '8rem',
            align: 'right',
            render: (ctx) => (
              <DecimalInput
                {...ctx.cell}
                ref={ctx.ref}
                scale={6}
                displayMinFraction={2}
                value={ctx.value}
                disabled={ctx.disabled}
                locale={locale}
                className="h-control-sm"
                onChange={ctx.setValue}
                onBlur={ctx.onBlur}
              />
            ),
          },
          {
            id: 'taxCodeId',
            header: t('fields.taxCode'),
            width: '9rem',
            render: (ctx) => (
              <TaxCodeSelect
                {...ctx.cell}
                ref={ctx.ref}
                type="vat"
                asOf={documentDate || undefined}
                value={ctx.value || null}
                disabled={ctx.disabled}
                onBlur={ctx.onBlur}
                onChange={(v) => ctx.setValue(v ?? '')}
              />
            ),
          },
        ] satisfies LineColumn<ReceiptLineValues>[])
      : []),
    {
      id: 'lotNo',
      header: t('fields.lotNo'),
      width: '9rem',
      render: (ctx) => (
        <Input
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value}
          maxLength={64}
          disabled={ctx.disabled || ctx.line.tracking === 'none'}
          placeholder={ctx.line.tracking === 'none' ? t('receipt.notTracked') : undefined}
          className="h-control-sm font-code"
          onChange={(e) => ctx.setValue(e.target.value)}
          onBlur={ctx.onBlur}
        />
      ),
    },
    {
      id: 'expiryDate',
      header: t('fields.expiryDate'),
      width: '9.5rem',
      render: (ctx) => (
        <DateInput
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value}
          min={documentDate || undefined}
          disabled={ctx.disabled || !ctx.line.hasExpiry}
          onChange={ctx.setValue}
          onBlur={ctx.onBlur}
        />
      ),
    },
    {
      id: 'serialsText',
      header: t('fields.serials'),
      width: '8rem',
      render: (ctx) =>
        ctx.line.tracking === 'serial' ? (
          <Button
            ref={ctx.ref}
            type="button"
            variant="secondary"
            size="sm"
            id={ctx.cell.id}
            aria-invalid={ctx.cell['aria-invalid']}
            aria-describedby={ctx.cell['aria-describedby']}
            aria-label={t('receipt.serialsButton', { row: ctx.index + 1 })}
            disabled={ctx.disabled}
            onClick={() => setSerialsFor(ctx.index)}
          >
            <ScanLine aria-hidden="true" />
            <span className="tabular-nums">{parseSerials(ctx.value).length}</span>
          </Button>
        ) : null,
    },
    {
      id: 'split',
      header: '',
      width: '3rem',
      readOnly: true,
      render: ({ line, index }) =>
        line.tracking !== 'none' && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('receipt.split', { row: index + 1 })}
            title={t('receipt.splitHint')}
            onClick={() =>
              form.setValue('lines', splitLine(form.getValues('lines'), index), {
                shouldDirty: true,
              })
            }
          >
            <ListPlus aria-hidden="true" />
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <DocumentLinesEditor<ReceiptValues, ReceiptLineValues>
        name="lines"
        label={t('receipt.lines')}
        columns={columns}
        disabled={disabled}
        newLine={emptyReceiptLine}
      />
      <SerialsDialogHost
        index={serialsFor}
        line={serialLine}
        onClose={() => setSerialsFor(null)}
        onSave={(text) => {
          if (serialsFor !== null)
            form.setValue(`lines.${serialsFor}.serialsText`, text, {
              shouldDirty: true,
              shouldValidate: form.formState.isSubmitted,
            })
        }}
      />
    </>
  )
}

function SerialsDialogHost({
  index,
  line,
  onClose,
  onSave,
}: {
  index: number | null
  line: ReceiptLineValues | undefined
  onClose: () => void
  onSave: (text: string) => void
}) {
  return (
    <SerialsDialog
      open={index !== null && line !== undefined}
      onOpenChange={(open) => !open && onClose()}
      item={line?.itemLabel ?? ''}
      quantity={line ? serialsNeeded(line).toString() : ''}
      value={line?.serialsText ?? ''}
      onSave={onSave}
    />
  )
}
