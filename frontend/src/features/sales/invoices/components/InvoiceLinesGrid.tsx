import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DecimalInput } from '@/components/shared/form'
import { DocumentLinesEditor, type LineColumn } from '@/components/shared/lines/DocumentLinesEditor'
import { Input } from '@/components/ui/input'
import { useIntlLocale } from '@/lib/datetime'
import { ItemCombobox, UnitSelect } from '@/features/catalog'
import { TaxCodeSelect, useTaxCodes } from '@/features/reference'
import { money } from '../kit/money'
import type { PreviewResult } from '../types'
import {
  emptyInvoiceLine,
  isBlankInvoiceLine,
  previewLineFor,
  toLineMath,
  type InvoiceLineValues,
  type InvoiceValues,
} from '../lib/lines'
import { lineAmounts } from '../lib/totals'

interface InvoiceLinesGridProps {
  disabled: boolean
  /** Typing a unit price needs sales.price_override; blank prices are resolved by the server. */
  canOverridePrice: boolean
  /** Server preview for the current lines (sent lines in order), when fresh. */
  preview: PreviewResult | null
}

/** Invoice lines: item, quantity, unit, price (resolved or overridden), discount, tax, amounts. */
export function InvoiceLinesGrid({ disabled, canOverridePrice, preview }: InvoiceLinesGridProps) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const form = useFormContext<InvoiceValues>()
  const lines = useWatch({ control: form.control, name: 'lines' })
  const documentDate = useWatch({ control: form.control, name: 'documentDate' })
  const currency = useWatch({ control: form.control, name: 'currencyCode' })
  const taxCodes = useTaxCodes().data

  // Same row selection as the request (lib/lines previewRowIndexes).
  const previewOf = (index: number) =>
    previewLineFor({ ...form.getValues(), lines }, preview, index)

  const set = (index: number, patch: Partial<InvoiceLineValues>) => {
    for (const [key, value] of Object.entries(patch)) {
      form.setValue(`lines.${index}.${key as keyof InvoiceLineValues}`, value, {
        shouldDirty: true,
      })
    }
  }
  const rateOf = (id: string | null | undefined) => taxCodes?.find((c) => c.id === id)?.rate ?? '0'

  const columns: LineColumn<InvoiceLineValues>[] = [
    {
      id: 'itemId',
      header: t('fields.item'),
      width: '17rem',
      render: (ctx) => (
        <ItemCombobox
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value || null}
          disabled={ctx.disabled || ctx.line.deliveryLineId !== ''}
          className="min-w-56"
          onBlur={ctx.onBlur}
          onChange={(id, item) => {
            ctx.setValue(id ?? '')
            set(ctx.index, {
              itemLabel: item ? `${item.code} · ${item.name}` : '',
              itemType: item?.type ?? '',
              unitId: item?.base_unit_id ?? '',
              description: ctx.line.description || (item?.name ?? ''),
              taxCodeId: item?.default_tax_code_id ?? ctx.line.taxCodeId,
              taxRate: item?.default_tax_code_id
                ? rateOf(item.default_tax_code_id)
                : ctx.line.taxRate,
              unitPrice: '',
            })
          }}
        />
      ),
    },
    {
      id: 'description',
      header: t('fields.description'),
      width: '14rem',
      render: (ctx) => (
        <Input
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value}
          maxLength={500}
          disabled={ctx.disabled}
          className="h-control-sm"
          onChange={(e) => ctx.setValue(e.target.value)}
          onBlur={ctx.onBlur}
        />
      ),
    },
    {
      id: 'quantity',
      header: t('fields.quantity'),
      width: '7.5rem',
      align: 'right',
      render: (ctx) => (
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
      ),
    },
    {
      id: 'unitId',
      header: t('fields.unit'),
      width: '7rem',
      render: (ctx) => (
        <UnitSelect
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value || null}
          disabled={ctx.disabled || ctx.line.deliveryLineId !== ''}
          onBlur={ctx.onBlur}
          onChange={(v) => ctx.setValue(v ?? '')}
        />
      ),
    },
    {
      id: 'unitPrice',
      header: t('fields.unitPrice'),
      width: '9rem',
      align: 'right',
      render: (ctx) => {
        const resolved = previewOf(ctx.index)
        return (
          <div>
            <DecimalInput
              {...ctx.cell}
              ref={ctx.ref}
              scale={4}
              displayMinFraction={2}
              value={ctx.value}
              disabled={ctx.disabled || !canOverridePrice}
              locale={locale}
              placeholder={resolved ? money(resolved.unit_price, locale) : t('invoice.autoPrice')}
              className="h-control-sm"
              onChange={ctx.setValue}
              onBlur={ctx.onBlur}
            />
            {ctx.value === '' && resolved?.price_source && (
              <p className="px-1 pt-0.5 text-right text-2xs text-muted-foreground">
                {t('invoice.priceSource', { source: resolved.price_source })}
              </p>
            )}
          </div>
        )
      },
    },
    {
      id: 'discountPercent',
      header: t('fields.discountPercent'),
      width: '6rem',
      align: 'right',
      render: (ctx) => (
        <DecimalInput
          {...ctx.cell}
          ref={ctx.ref}
          scale={2}
          displayMinFraction={0}
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
      width: '11rem',
      render: (ctx) => (
        <TaxCodeSelect
          {...ctx.cell}
          ref={ctx.ref}
          type="vat"
          asOf={documentDate || undefined}
          value={ctx.value || null}
          disabled={ctx.disabled}
          onBlur={ctx.onBlur}
          onChange={(v, row) => {
            ctx.setValue(v ?? '')
            set(ctx.index, { taxRate: row?.rate ?? '0' })
          }}
        />
      ),
    },
    {
      id: 'net',
      header: t('fields.netAmount'),
      width: '8rem',
      align: 'right',
      readOnly: true,
      render: ({ line, index }) => {
        if (isBlankInvoiceLine(line)) return null
        const p = previewOf(index)
        const net = p?.net_amount ?? lineAmounts(toLineMath(line)).net
        return (
          <span className="tabular-nums" data-testid={`line-net-${index}`}>
            {money(net, locale)}
          </span>
        )
      },
    },
    {
      id: 'total',
      header: t('fields.lineTotal'),
      width: '8rem',
      align: 'right',
      readOnly: true,
      render: ({ line, index }) => {
        if (isBlankInvoiceLine(line)) return null
        const p = previewOf(index)
        const total = p?.line_total ?? lineAmounts(toLineMath(line)).total
        return <span className="tabular-nums">{money(total, locale, currency)}</span>
      },
    },
  ]

  return (
    <DocumentLinesEditor<InvoiceValues, InvoiceLineValues>
      name="lines"
      label={t('invoice.lines')}
      columns={columns}
      disabled={disabled}
      newLine={emptyInvoiceLine}
    />
  )
}
