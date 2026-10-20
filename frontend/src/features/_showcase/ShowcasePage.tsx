import { zodResolver } from '@hookform/resolvers/zod'
import { createColumnHelper } from '@tanstack/react-table'
import Decimal from 'decimal.js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ApprovalTimeline } from '@/components/shared/ApprovalTimeline'
import { AttachmentPanel } from '@/components/shared/attachments'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, useListQuery, type ListQueryState } from '@/components/shared/data-table'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  AsyncCombobox,
  Combobox,
  DateInput,
  Form,
  FormErrorSummary,
  FormField,
  MoneyInput,
  QuantityInput,
} from '@/components/shared/form'
import { DocumentLinesEditor, type LineColumn } from '@/components/shared/lines/DocumentLinesEditor'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, useIntlLocale } from '@/lib/datetime'
import { calendarDate, decimalString, MSG } from '@/lib/forms'
import { formatMoney, lineAmount } from '@/lib/money'
import {
  ACCOUNT_OPTIONS,
  ACCOUNTS,
  APPROVAL_STEPS,
  AUDIT_ENTRIES,
  createFakeAttachmentApi,
  fetchAccounts,
  PRODUCTS,
  searchCustomers,
  type Account,
} from './fakeData'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={`sc-${title}`}>
      <h2 id={`sc-${title}`} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

function TableDemo() {
  const { t } = useTranslation('common')
  const locale = useIntlLocale()
  const { query, setQuery } = useListQuery({ perPage: 25, sort: [{ id: 'code', desc: false }] })
  const [rows, setRows] = useState(ACCOUNTS)
  const [result, setResult] = useState<{ key: string; data: Account[]; total: number } | null>(null)
  const key = JSON.stringify([query, rows.length])

  useEffect(() => {
    let alive = true
    void fetchAccounts(query, rows).then((r) => {
      if (alive) setResult({ key: JSON.stringify([query, rows.length]), ...r })
    })
    return () => {
      alive = false
    }
  }, [query, rows])

  const columns = useMemo(() => {
    const col = createColumnHelper<Account>()
    return [
      col.accessor('code', {
        header: t('showcase.fields.code'),
        enableSorting: true,
        meta: { label: t('showcase.fields.code') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 120,
      }),
      col.accessor('name', {
        header: t('showcase.fields.name'),
        enableSorting: true,
        meta: { label: t('showcase.fields.name') },
        size: 260,
      }),
      col.accessor('status', {
        header: t('showcase.fields.status'),
        meta: {
          label: t('showcase.fields.status'),
          filter: {
            options: (['active', 'inactive', 'draft'] as const).map((s) => ({
              value: s,
              label: t(`status.${s}`),
            })),
          },
        },
        cell: (c) => <StatusBadge status={c.getValue()} />,
        size: 130,
      }),
      col.accessor('balance', {
        header: t('showcase.fields.balance'),
        enableSorting: true,
        meta: { label: t('showcase.fields.balance'), align: 'right' },
        cell: (c) => formatMoney(c.getValue(), 'TRY', locale),
        size: 150,
      }),
      col.accessor('created_at', {
        header: t('showcase.fields.createdAt'),
        enableSorting: true,
        meta: { label: t('showcase.fields.createdAt') },
        cell: (c) => formatDateTime(c.getValue(), locale),
        size: 160,
      }),
    ]
  }, [t, locale])

  const fresh = result?.key === key
  return (
    <DataTable<Account>
      label={t('showcase.dataTable')}
      columns={columns}
      data={result?.data ?? []}
      total={result?.total ?? 0}
      loading={!fresh}
      query={query}
      onQueryChange={(next: ListQueryState) => setQuery(next)}
      getRowId={(r) => r.id}
      viewKey="showcase.accounts"
      selectable
      enableColumnResizing
      maxHeight="28rem"
      bulkActions={({ selectedIds, clear }) => (
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setRows((all) => all.filter((r) => !selectedIds.includes(r.id)))
            clear()
          }}
        >
          {t('showcase.deleteSelected')}
        </Button>
      )}
    />
  )
}

const headerSchema = z.object({
  customer: z.string().min(1, MSG.required),
  account: z.string().min(1, MSG.required),
  amount: decimalString({ positive: true, scale: 2 }),
  quantity: decimalString({ positive: true, scale: 3 }),
  date: calendarDate(),
  note: z.string().max(500),
})
type HeaderValues = z.infer<typeof headerSchema>

function FormDemo() {
  const { t } = useTranslation('common')
  const [serverError, setServerError] = useState<unknown>(null)
  const [done, setDone] = useState(false)
  const form = useForm<HeaderValues>({
    resolver: zodResolver(headerSchema),
    defaultValues: { customer: '', account: '', amount: '', quantity: '1.000', date: '', note: '' },
  })
  const labels = {
    customer: t('showcase.fields.customer'),
    account: t('showcase.fields.account'),
    amount: t('showcase.fields.amount'),
    quantity: t('showcase.fields.quantity'),
    date: t('showcase.fields.date'),
    note: t('showcase.fields.note'),
  }

  return (
    <Form
      form={form}
      onSubmit={() => {
        setServerError(null)
        setDone(true)
      }}
      className="grid max-w-3xl gap-4 sm:grid-cols-2"
    >
      <FormErrorSummary error={serverError} fieldLabels={labels} className="sm:col-span-2" />
      <FormField<HeaderValues, 'customer'>
        name="customer"
        label={labels.customer}
        required
        render={({ field, control }) => (
          <AsyncCombobox
            {...control}
            ref={field.ref}
            value={field.value || null}
            onChange={(v) => field.onChange(v ?? '')}
            onBlur={field.onBlur}
            loadOptions={searchCustomers}
            minQueryLength={1}
            clearable
          />
        )}
      />
      <FormField<HeaderValues, 'account'>
        name="account"
        label={labels.account}
        required
        render={({ field, control }) => (
          <Combobox
            {...control}
            ref={field.ref}
            value={field.value || null}
            onChange={(v) => field.onChange(v ?? '')}
            onBlur={field.onBlur}
            options={ACCOUNT_OPTIONS}
          />
        )}
      />
      <FormField<HeaderValues, 'amount'>
        name="amount"
        label={labels.amount}
        required
        render={({ field, control }) => (
          <MoneyInput
            {...control}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <FormField<HeaderValues, 'quantity'>
        name="quantity"
        label={labels.quantity}
        required
        render={({ field, control }) => (
          <QuantityInput
            {...control}
            ref={field.ref}
            unit="kg"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <FormField<HeaderValues, 'date'>
        name="date"
        label={labels.date}
        required
        render={({ field, control }) => (
          <DateInput
            {...control}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <FormField<HeaderValues, 'note'>
        name="note"
        label={labels.note}
        className="sm:col-span-2"
        render={({ field, control }) => <Textarea {...control} {...field} />}
      />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit">{t('showcase.submit')}</Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setDone(false)
            setServerError({
              errors: {
                message: 'Kayıt doğrulanamadı.',
                code: 'VALIDATION_FAILED',
                fields: {
                  amount: ['Tutar müşteri kredi limitini aşıyor.'],
                  currency_rate: ['Kur bilgisi alınamadı.'],
                },
              },
            })
          }}
        >
          {t('showcase.simulateServerError')}
        </Button>
        {done && (
          <p role="status" className="text-sm text-success">
            {t('showcase.submitted')}
          </p>
        )}
      </div>
    </Form>
  )
}

const lineSchema = z.object({
  product: z.string().min(1, MSG.required),
  quantity: decimalString({ positive: true, scale: 3 }),
  unitPrice: decimalString({ nonNegative: true, scale: 2 }),
})
const linesSchema = z.object({ lines: z.array(lineSchema).min(1, MSG.required) })
type LinesValues = z.infer<typeof linesSchema>
type Line = LinesValues['lines'][number]

const CANONICAL = /^-?\d+(?:\.\d+)?$/
function lineTotal(line: Line | undefined): Decimal | null {
  if (!line || !CANONICAL.test(line.quantity) || !CANONICAL.test(line.unitPrice)) return null
  // Rounded per line (lib/money lineAmount) so the total equals the sum of the shown lines.
  return lineAmount(line.quantity, line.unitPrice)
}

function LinesDemo() {
  const { t } = useTranslation('common')
  const locale = useIntlLocale()
  const [done, setDone] = useState(false)
  const form = useForm<LinesValues>({
    resolver: zodResolver(linesSchema),
    defaultValues: { lines: [{ product: 'p-1', quantity: '2.000', unitPrice: '185.50' }] },
  })
  const columns: LineColumn<Line>[] = [
    {
      id: 'product',
      header: t('showcase.fields.product'),
      width: '40%',
      render: (c) => (
        <Combobox
          {...c.cell}
          ref={c.ref}
          value={c.value || null}
          onChange={(v) => c.setValue(v ?? '')}
          onBlur={c.onBlur}
          options={PRODUCTS}
          className="min-w-48"
        />
      ),
    },
    {
      id: 'quantity',
      header: t('showcase.fields.quantity'),
      align: 'right',
      render: (c) => (
        <QuantityInput
          {...c.cell}
          ref={c.ref}
          value={c.value}
          onChange={c.setValue}
          onBlur={c.onBlur}
        />
      ),
    },
    {
      id: 'unitPrice',
      header: t('showcase.fields.unitPrice'),
      align: 'right',
      render: (c) => (
        <MoneyInput
          {...c.cell}
          ref={c.ref}
          value={c.value}
          onChange={c.setValue}
          onBlur={c.onBlur}
        />
      ),
    },
    {
      id: 'total',
      header: t('showcase.fields.lineTotal'),
      align: 'right',
      readOnly: true,
      render: (c) => {
        const total = lineTotal(c.line)
        return <span>{total ? formatMoney(total.toFixed(2), 'TRY', locale) : '—'}</span>
      },
    },
  ]
  return (
    <Form form={form} onSubmit={() => setDone(true)} className="space-y-3">
      <DocumentLinesEditor<LinesValues, Line>
        name="lines"
        columns={columns}
        newLine={() => ({ product: '', quantity: '1.000', unitPrice: '' })}
        footer={(lines) => {
          const sum = lines.reduce((acc, l) => acc.plus(lineTotal(l) ?? 0), new Decimal(0))
          return (
            <p className="flex justify-end gap-4 text-sm font-semibold">
              <span>{t('showcase.total')}</span>
              <span>{formatMoney(sum.toFixed(2), 'TRY', locale)}</span>
            </p>
          )
        }}
      />
      <div className="flex items-center gap-2">
        <Button type="submit">{t('showcase.submit')}</Button>
        {done && (
          <p role="status" className="text-sm text-success">
            {t('showcase.submitted')}
          </p>
        )}
      </div>
    </Form>
  )
}

export function ShowcasePage() {
  const { t } = useTranslation('common')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const attachmentApi = useMemo(() => createFakeAttachmentApi(), [])
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-6 py-6">
      <PageHeader title={t('showcase.title')} description={t('showcase.description')} />
      <Section title={t('showcase.dataTable')}>
        <TableDemo />
      </Section>
      <Section title={t('showcase.form')}>
        <FormDemo />
      </Section>
      <Section title={t('showcase.lines')}>
        <LinesDemo />
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('showcase.status')}>
          <Card className="flex flex-wrap gap-2 p-4">
            {[
              'draft',
              'pending_approval',
              'approved',
              'rejected',
              'cancelled',
              'posted',
              'completed',
              'closed',
            ].map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </Card>
        </Section>
        <Section title={t('showcase.approval')}>
          <Card className="p-4">
            <ApprovalTimeline steps={APPROVAL_STEPS} />
          </Card>
        </Section>
        <Section title={t('showcase.attachments')}>
          <Card className="p-4">
            <AttachmentPanel api={attachmentApi} />
          </Card>
        </Section>
        <Section title={t('showcase.audit')}>
          <AuditTrail
            entries={AUDIT_ENTRIES}
            fieldLabels={{ status: t('showcase.fields.status') }}
          />
        </Section>
      </div>
      <Section title={t('showcase.dialogs')}>
        <Card className="space-y-4 p-4">
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            {t('showcase.openConfirm')}
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            description={t('attachments.removeBody', { name: 'teklif.pdf' })}
            confirmLabel={t('actions.delete')}
            onConfirm={() => new Promise((resolve) => setTimeout(resolve, 600))}
          />
          <EmptyState description={t('dataTable.emptyBody')} />
        </Card>
      </Section>
    </div>
  )
}
