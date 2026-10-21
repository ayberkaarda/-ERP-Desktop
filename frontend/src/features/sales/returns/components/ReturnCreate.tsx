import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import {
  DateInput,
  DecimalInput,
  Form,
  FormErrorSummary,
  FormField,
} from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { WarehouseSelect } from '@/features/reference'
import type { Invoice } from '../../invoices/api'
import { usePayloadKeys } from '../../invoices/kit/idempotency'
import { salesDocsKeys } from '../../invoices/kit/keys'
import { INVOICES_BASE, RETURNS_BASE } from '../../invoices/kit/links'
import { dec, money, qty } from '../../invoices/kit/money'
import { SALES_PERMS } from '../../invoices/kit/permissions'
import { returnsApi } from '../api'
import {
  selectionProblems,
  selectionValue,
  toReturnInput,
  valuesFromInvoice,
  type ReturnValues,
} from '../lib/selection'

/** Step one of a return: pick invoice lines and quantities, then create the draft. */
export function ReturnCreate({
  invoice,
  returned,
}: {
  invoice: Invoice
  /** Quantity per invoice line on the invoice's other returns. */
  returned: Readonly<Record<string, string>>
}) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canCreate = usePermission(SALES_PERMS.returns.create)
  const company = useCompanyStore((s) => s.activeCompanyId)
  const [lastValues, setLastValues] = useState<ReturnValues | null>(null)

  const resolver: Resolver<ReturnValues> = useMemo(
    () => (values) => {
      const errors: Record<string, unknown> = {}
      if (!values.documentDate)
        errors.documentDate = { type: 'required', message: t('validation.date') }
      if (!values.lines.some((l) => l.selected))
        errors.lines = { root: { type: 'min', message: t('validation.selectLines') } }
      const problems = selectionProblems(values)
      if (problems.length > 0) {
        const lines: Record<number, unknown> = {}
        for (const p of problems) {
          lines[p.index] = {
            quantity: {
              type: p.message,
              message:
                p.message === 'quantity'
                  ? t('validation.quantityPositive')
                  : t('validation.overReturnable'),
            },
          }
        }
        errors.lines = { ...(errors.lines as object | undefined), ...lines }
      }
      return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} }
    },
    [t],
  )
  const form = useForm<ReturnValues>({
    resolver,
    defaultValues: valuesFromInvoice(invoice.lines, invoice.warehouse_id ?? '', returned),
  })
  const values = useWatch({ control: form.control }) as ReturnValues
  const selected = values.lines.filter((l) => l.selected).length

  const create = useMutation({
    mutationFn: ({ v }: { v: ReturnValues; company: string | null }) => {
      setLastValues(v)
      const input = toReturnInput(v)
      return returnsApi.createFromInvoice(
        invoice.id,
        input,
        keyFor({ invoice: invoice.id, ...input }),
      )
    },
    onSuccess: (ret, { company: started }) => {
      const c = started ?? 'none'
      queryClient.setQueryData(salesDocsKeys.detail('returns', ret.id, c), ret)
      void queryClient.invalidateQueries({ queryKey: salesDocsKeys.branch('returns', c) })
      keyFor.reset()
      if (useCompanyStore.getState().activeCompanyId !== started) return
      platform.notify.success(t('return.created'))
      void navigate(`${RETURNS_BASE}/${ret.id}`, { replace: true })
    },
  })

  /** Server `lines.N.*` count only the selected lines. */
  const mapField = (path: string) => {
    const v = lastValues ?? form.getValues()
    const sent = v.lines.flatMap((l, i) => (l.selected ? [i] : []))
    const m = /^lines\.(\d+)\.([a-z_]+)/.exec(path)
    if (m) {
      const index = sent[Number(m[1])]
      return index === undefined ? 'lines' : `lines.${index}.quantity`
    }
    return (
      ({ document_date: 'documentDate', warehouse_id: 'warehouseId' } as Record<string, string>)[
        path
      ] ?? path
    )
  }

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1 align-top'
  const tdr = `${td} text-right tabular-nums`
  const linesError = form.formState.errors.lines?.root?.message

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('return.newTitle')}
        description={t('return.newDescription', { number: invoice.number ?? '' })}
        breadcrumbs={[
          { label: t('nav.sales') },
          { label: t('return.listTitle'), to: RETURNS_BASE },
          { label: t('return.new') },
        ]}
        actions={
          <Button asChild variant="ghost">
            <Link to={`${INVOICES_BASE}/${invoice.id}`}>{t('return.backToInvoice')}</Link>
          </Button>
        }
      />
      <Form form={form} onSubmit={(v) => create.mutate({ v, company })} className="space-y-4">
        <FormErrorSummary
          error={create.error}
          mapField={mapField}
          fieldLabels={{
            documentDate: t('fields.documentDate'),
            warehouseId: t('fields.returnWarehouse'),
            reason: t('fields.reason'),
          }}
        />
        <section
          aria-label={t('editor.header')}
          className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-[10rem_1fr_1fr]"
        >
          <FormField<ReturnValues, 'documentDate'>
            name="documentDate"
            label={t('fields.documentDate')}
            required
            render={({ field, control }) => (
              <DateInput
                {...control}
                ref={field.ref}
                value={field.value}
                min={invoice.document_date}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <FormField<ReturnValues, 'warehouseId'>
            name="warehouseId"
            label={t('fields.returnWarehouse')}
            render={({ field, control }) => (
              <WarehouseSelect
                {...control}
                ref={field.ref}
                value={field.value || null}
                onBlur={field.onBlur}
                onChange={(v) => field.onChange(v ?? '')}
              />
            )}
          />
          <FormField<ReturnValues, 'reason'>
            name="reason"
            label={t('fields.reason')}
            render={({ field, control }) => <Input {...control} {...field} maxLength={500} />}
          />
        </section>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table
            className="w-full border-separate border-spacing-0 text-table"
            aria-label={t('return.pickLines')}
          >
            <thead className="bg-surface-sunken text-xs text-muted-foreground">
              <tr>
                <th className={th}>
                  <span className="sr-only">{t('return.select')}</span>
                </th>
                <th className={th}>{t('fields.item')}</th>
                <th className={thr}>{t('fields.invoicedQuantity')}</th>
                <th className={thr}>{t('fields.returnable')}</th>
                <th className={thr}>{t('fields.returnQuantity')}</th>
                <th className={thr}>{t('fields.unitPrice')}</th>
              </tr>
            </thead>
            <tbody>
              {values.lines.map((l, i) => {
                const none = dec(l.returnable).isZero()
                return (
                  <tr key={l.invoiceLineId} className={none ? 'text-muted-foreground' : undefined}>
                    <td className={td}>
                      <Checkbox
                        aria-label={t('return.selectLine', { item: l.itemLabel })}
                        checked={l.selected}
                        disabled={none}
                        onChange={(e) =>
                          form.setValue(`lines.${i}.selected`, e.target.checked, {
                            shouldDirty: true,
                          })
                        }
                      />
                    </td>
                    <td className={td}>{l.itemLabel}</td>
                    <td className={tdr}>
                      {qty(l.invoiced, locale)} {l.unitCode}
                    </td>
                    <td className={tdr}>{qty(l.returnable, locale)}</td>
                    <td className={`${td} w-36`}>
                      <Controller
                        control={form.control}
                        name={`lines.${i}.quantity`}
                        render={({ field, fieldState }) => (
                          <>
                            <DecimalInput
                              ref={field.ref}
                              aria-label={t('return.quantityFor', { item: l.itemLabel })}
                              aria-invalid={fieldState.error ? true : undefined}
                              scale={6}
                              displayMinFraction={0}
                              value={field.value}
                              disabled={!l.selected}
                              className="h-control-sm"
                              onChange={field.onChange}
                              onBlur={field.onBlur}
                            />
                            {fieldState.error && (
                              <p className="pt-0.5 text-2xs text-danger">
                                {fieldState.error.message}
                              </p>
                            )}
                          </>
                        )}
                      />
                    </td>
                    <td className={tdr}>{money(l.unitPrice, locale)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {linesError && (
          <p role="alert" className="text-sm text-danger">
            {linesError}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground tabular-nums" data-testid="return-summary">
            {t('return.summary', {
              count: selected,
              amount: money(selectionValue(values), locale, invoice.currency_code),
            })}
          </p>
          {canCreate && (
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              {t('return.create')}
            </Button>
          )}
        </div>
      </Form>
    </div>
  )
}
