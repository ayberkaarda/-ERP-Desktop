import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DecimalInput } from '@/components/shared/form'
import { DocumentLinesEditor, type LineColumn } from '@/components/shared/lines/DocumentLinesEditor'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ItemCombobox, UnitSelect } from '@/features/catalog'
import { TaxCodeSelect, useTaxCodes } from '@/features/reference'
import { dec, money } from '@/features/sales/invoices/kit/money'
import { useIntlLocale } from '@/lib/datetime'
import {
  emptyInvoiceLine,
  isBlankInvoiceLine,
  isSourced,
  previewLineFor,
  priceOverridden,
  purchaseLineAmounts,
  withholdingPercent,
  type InvoiceLineValues,
  type InvoiceValues,
} from '../lib/lines'
import type { PreviewResult } from '../types'

interface InvoiceLinesGridProps {
  disabled: boolean
  /** Pricing a receipt/order line differently from its source needs purchasing.price_override. */
  canOverridePrice: boolean
  preview: PreviewResult | null
}

/**
 * Supplier invoice lines: direct item lines (item, unit, price, discount, VAT, withholding) and
 * lines taken from receipts or orders (only quantity, and price with price_override).
 */
export function InvoiceLinesGrid({ disabled, canOverridePrice, preview }: InvoiceLinesGridProps) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const form = useFormContext<InvoiceValues>()
  const lines = useWatch({ control: form.control, name: 'lines' })
  const documentDate = useWatch({ control: form.control, name: 'documentDate' })
  const currency = useWatch({ control: form.control, name: 'currencyCode' })
  const vat = useTaxCodes({ type: 'vat' }).data
  const withholding = useTaxCodes({ type: 'withholding' }).data

  const previewOf = (index: number) =>
    previewLineFor({ ...form.getValues(), lines }, preview, index)

  const set = (index: number, patch: Partial<InvoiceLineValues>) => {
    for (const [key, value] of Object.entries(patch)) {
      form.setValue(`lines.${index}.${key as keyof InvoiceLineValues}`, value, {
        shouldDirty: true,
      })
    }
  }
  const rateOf = (id: string | null | undefined) => vat?.find((c) => c.id === id)?.rate ?? '0'

  const columns: LineColumn<InvoiceLineValues>[] = [
    {
      id: 'itemId',
      header: t('fields.item'),
      width: '17rem',
      render: (ctx) => (
        <div>
          <ItemCombobox
            {...ctx.cell}
            ref={ctx.ref}
            value={ctx.value || null}
            disabled={ctx.disabled || isSourced(ctx.line)}
            className="min-w-56"
            onBlur={ctx.onBlur}
            onChange={(id, item) => {
              ctx.setValue(id ?? '')
              const tax = item?.purchase_tax_code_id ?? item?.default_tax_code_id ?? null
              set(ctx.index, {
                itemLabel: item ? `${item.code} · ${item.name}` : '',
                itemType: item?.type ?? '',
                unitId: item?.base_unit_id ?? '',
                description: ctx.line.description || (item?.name ?? ''),
                taxCodeId: tax ?? ctx.line.taxCodeId,
                taxRate: tax ? rateOf(tax) : ctx.line.taxRate,
              })
            }}
          />
          {isSourced(ctx.line) && (
            <Badge tone="info" className="mt-0.5">
              {ctx.line.receiptLineId ? t('invoice.fromReceipt') : t('invoice.fromOrder')}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: 'description',
      header: t('fields.description'),
      width: '13rem',
      render: (ctx) => (
        <Input
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value}
          maxLength={500}
          disabled={ctx.disabled || isSourced(ctx.line)}
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
          disabled={ctx.disabled || isSourced(ctx.line)}
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
        const locked = isSourced(ctx.line) && !canOverridePrice
        return (
          <div>
            <DecimalInput
              {...ctx.cell}
              ref={ctx.ref}
              scale={6}
              displayMinFraction={2}
              value={ctx.value}
              disabled={ctx.disabled || locked}
              locale={locale}
              className="h-control-sm"
              onChange={ctx.setValue}
              onBlur={ctx.onBlur}
            />
            {priceOverridden(ctx.line) && (
              <p className="px-1 pt-0.5 text-right text-2xs text-warning-soft-foreground">
                {t('invoice.priceOverridden', { price: money(ctx.line.sourcePrice, locale) })}
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
          disabled={ctx.disabled || isSourced(ctx.line)}
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
      width: '10rem',
      render: (ctx) => (
        <TaxCodeSelect
          {...ctx.cell}
          ref={ctx.ref}
          type="vat"
          asOf={documentDate || undefined}
          value={ctx.value || null}
          disabled={ctx.disabled || isSourced(ctx.line)}
          onBlur={ctx.onBlur}
          onChange={(v, row) => {
            ctx.setValue(v ?? '')
            set(ctx.index, { taxRate: row?.rate ?? '0' })
          }}
        />
      ),
    },
    {
      id: 'withholdingCodeId',
      header: t('fields.withholdingCode'),
      width: '10rem',
      render: (ctx) => (
        <TaxCodeSelect
          {...ctx.cell}
          ref={ctx.ref}
          type="withholding"
          asOf={documentDate || undefined}
          value={ctx.value || null}
          disabled={ctx.disabled || isSourced(ctx.line)}
          onBlur={ctx.onBlur}
          onChange={(v) => {
            ctx.setValue(v ?? '')
            set(ctx.index, {
              withholdingRate: withholdingPercent(withholding?.find((c) => c.id === v)),
            })
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
        const net = previewOf(index)?.net_amount ?? purchaseLineAmounts(line).net
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
        const a = purchaseLineAmounts(line)
        const w = p?.withholding_amount ?? a.withholding
        return (
          <span className="tabular-nums">
            {money(p?.line_total ?? a.total, locale, currency)}
            {!dec(w).isZero() && (
              <span className="block text-2xs text-muted-foreground">
                {t('invoice.lineWithholding', { amount: money(w, locale) })}
              </span>
            )}
          </span>
        )
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
