import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DateInput, DecimalInput, FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { WarehouseSelect } from '@/features/reference'
import { ActionError } from '@/features/sales/invoices/kit/components/ActionError'
import { LoadError } from '@/features/sales/invoices/kit/components/LoadError'
import { money, qty } from '@/features/sales/invoices/kit/money'
import { formatDate, toIsoDate, useIntlLocale } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { useCompanyStore } from '@/stores/company'
import { invoicesApi } from '../../invoices/api'
import { createKeys } from '../../invoices/kit/createKeys'
import { activeCompany, invalidatePurchEffects, purchKeys } from '../../invoices/kit/keys'
import { readServerError } from '@/lib/forms'
import { INVOICES_BASE, RECEIPTS_BASE, RETURNS_BASE } from '../../invoices/kit/links'
import { receiptsApi } from '../../receipts/api'
import { returnedPerLine, returnsApi } from '../api'
import {
  isSelected,
  overReturnable,
  rowsFromInvoice,
  rowsFromReceipt,
  selectionValue,
  serialProblem,
  toCreateInput,
  type ReturnSourceKind,
  type SelectionRow,
} from '../lib/selection'
import type { ReturnCreateInput } from '../types'

interface SourceData {
  kind: ReturnSourceKind
  id: string
  number: string | null
  partyName: string
  documentDate: string
  currency: string
  warehouseId: string
  rows: SelectionRow[]
}

async function loadSource(
  kind: ReturnSourceKind,
  id: string,
  signal?: AbortSignal,
): Promise<SourceData> {
  if (kind === 'invoice') {
    const inv = await invoicesApi.get(id, signal)
    const returned = inv.lines.every((l) => l.returnable_quantity !== undefined)
      ? null
      : await returnedPerLine(inv.raw_links, 'invoice_line_id', signal).catch(() => null)
    return {
      kind,
      id,
      number: inv.number,
      partyName: inv.party_snapshot.name,
      documentDate: inv.document_date,
      currency: inv.currency_code,
      warehouseId: inv.warehouse_id ?? '',
      rows: rowsFromInvoice(inv, returned),
    }
  }
  const r = await receiptsApi.get(id, signal)
  const returned = r.lines.every((l) => l.returnable_quantity !== undefined)
    ? null
    : await returnedPerLine(r.raw_links, 'receipt_line_id', signal).catch(() => null)
  return {
    kind,
    id,
    number: r.number,
    partyName: r.party_snapshot.name,
    documentDate: r.document_date,
    currency: r.currency_code,
    warehouseId: r.warehouse_id ?? '',
    rows: rowsFromReceipt(r, returned),
  }
}

/**
 * /purchasing/returns/new?invoice=<id> | ?receipt=<id>: pick lines and quantities (bounded by
 * what is still returnable), lots and serials; creates a draft return.
 */
export function ReturnCreate({ kind, sourceId }: { kind: ReturnSourceKind; sourceId: string }) {
  useCompanyStore((s) => s.activeCompanyId)
  const source = useQuery({
    queryKey: purchKeys.returnSource(kind, sourceId),
    queryFn: ({ signal }) => loadSource(kind, sourceId, signal),
  })
  if (source.data) return <ReturnForm key={source.data.id} source={source.data} />
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
      {source.isError ? (
        <LoadError error={source.error} onRetry={() => void source.refetch()} />
      ) : (
        <>
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-64 w-full" />
        </>
      )}
    </div>
  )
}

function ReturnForm({ source }: { source: SourceData }) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState(source.rows)
  const [documentDate, setDocumentDate] = useState(() => toIsoDate(new Date()))
  const [warehouseId, setWarehouseId] = useState(source.warehouseId)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const selected = rows.filter(isSelected)
  const over = rows.some(overReturnable)
  const serialsBad = rows.some(serialProblem)
  const blocked = selected.length === 0 || over || serialsBad || !documentDate

  const mutation = useMutation({
    mutationFn: ({ input, company }: { input: ReturnCreateInput; company: string }) => {
      const key = createKeys.keyFor(company, `return-from-${source.kind}:${source.id}`, input)
      return source.kind === 'invoice'
        ? returnsApi.fromInvoice(source.id, input, key)
        : returnsApi.fromReceipt(source.id, input, key)
    },
    onSuccess: (created, { input, company }) => {
      createKeys.release(company, `return-from-${source.kind}:${source.id}`, input)
      queryClient.setQueryData(purchKeys.detail('returns', created.id, company), created)
      invalidatePurchEffects(queryClient, company)
      if (activeCompany() !== company) return
      void navigate(`${RETURNS_BASE}/${created.id}`, { replace: true })
    },
  })

  // Server field errors `lines.N.quantity` (N among the sent, selected rows) shown on that row.
  const serverFields = readServerError(mutation.error)?.fields ?? {}
  const rowError = (row: SelectionRow): string | undefined => {
    const at = selected.indexOf(row)
    return at < 0 ? undefined : serverFields[`lines.${at}.quantity`]?.[0]
  }

  const update = (index: number, patch: Partial<SelectionRow>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const sourceBase = source.kind === 'invoice' ? INVOICES_BASE : RECEIPTS_BASE
  const title = t('return.newTitle')
  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1 align-top'
  const tdr = `${td} text-right tabular-nums`

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
      <PageHeader
        title={title}
        description={
          source.kind === 'invoice' ? t('return.fromInvoiceHint') : t('return.fromReceiptHint')
        }
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t('return.listTitle'), to: RETURNS_BASE },
          { label: title },
        ]}
        actions={
          <Button
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              setTouched(true)
              if (blocked) return
              mutation.mutate({
                input: toCreateInput(source.kind, rows, {
                  documentDate,
                  warehouseId,
                  reason,
                  notes,
                }),
                company: activeCompany(),
              })
            }}
          >
            {mutation.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            {t('return.create')}
          </Button>
        }
      />
      <section
        aria-label={t('editor.header')}
        className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-4"
      >
        <div className="text-sm md:col-span-2">
          <p className="text-xs text-muted-foreground">
            {source.kind === 'invoice' ? t('return.sourceInvoice') : t('return.sourceReceipt')}
          </p>
          <p>
            <Link
              to={`${sourceBase}/${encodeURIComponent(source.id)}`}
              className="font-code text-primary hover:underline"
            >
              {source.number ?? t('links.unnumbered')}
            </Link>{' '}
            · {source.partyName} · {formatDate(source.documentDate, locale)}
          </p>
        </div>
        <FieldShell label={t('fields.documentDate')} required>
          {(control) => <DateInput {...control} value={documentDate} onChange={setDocumentDate} />}
        </FieldShell>
        <FieldShell label={t('return.warehouse')}>
          {(control) => (
            <WarehouseSelect
              {...control}
              value={warehouseId || null}
              onChange={(v) => setWarehouseId(v ?? '')}
            />
          )}
        </FieldShell>
        <div className="md:col-span-2">
          <FieldShell label={t('fields.reason')}>
            {(control) => (
              <Input
                {...control}
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FieldShell>
        </div>
        <div className="md:col-span-2">
          <FieldShell label={t('fields.notes')}>
            {(control) => (
              <Input
                {...control}
                value={notes}
                maxLength={5000}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </FieldShell>
        </div>
      </section>
      {touched && selected.length === 0 && (
        <p role="alert" className="text-sm text-danger">
          {t('return.selectSome')}
        </p>
      )}
      <ActionError error={mutation.error} />
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          className="w-full border-separate border-spacing-0 text-table"
          aria-label={t('return.lines')}
        >
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th className={thr}>#</th>
              <th className={th}>{t('fields.item')}</th>
              <th className={thr}>{t('return.sourceQuantity')}</th>
              <th className={thr}>{t('return.returnable')}</th>
              <th className={thr}>{t('return.quantity')}</th>
              <th className={th}>{t('fields.lotNo')}</th>
              <th className={th}>{t('fields.serials')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const overRow = overReturnable(r)
              const serialRow = serialProblem(r)
              return (
                <tr key={r.sourceLineId}>
                  <td className={tdr}>{r.lineNo}</td>
                  <td className={td}>{r.itemLabel}</td>
                  <td className={tdr}>
                    {qty(r.sourceQuantity, locale)} {r.unitCode}
                  </td>
                  <td className={tdr} data-testid={`returnable-${r.lineNo}`}>
                    {r.returnable === null
                      ? '—'
                      : r.upperBound
                        ? t('return.atMost', { quantity: qty(r.returnable, locale) })
                        : qty(r.returnable, locale)}
                  </td>
                  <td className={cn(td, 'w-36')}>
                    <DecimalInput
                      aria-label={t('return.quantityRow', { row: r.lineNo })}
                      aria-invalid={overRow || undefined}
                      scale={6}
                      displayMinFraction={0}
                      value={r.quantity}
                      locale={locale}
                      className="h-control-sm"
                      onChange={(v) => update(i, { quantity: v })}
                    />
                    {!overRow && rowError(r) && (
                      <p role="alert" className="pt-0.5 text-right text-2xs text-danger">
                        {rowError(r)}
                      </p>
                    )}
                    {overRow && (
                      <p role="alert" className="pt-0.5 text-right text-2xs text-danger">
                        {t('return.overReturnable')}
                      </p>
                    )}
                  </td>
                  <td className={cn(td, 'w-36')}>
                    <Input
                      aria-label={t('return.lotRow', { row: r.lineNo })}
                      value={r.lotNo}
                      maxLength={64}
                      disabled={r.tracking === 'none'}
                      className="h-control-sm font-code"
                      onChange={(e) => update(i, { lotNo: e.target.value })}
                    />
                  </td>
                  <td className={cn(td, 'w-56')}>
                    {r.tracking === 'serial' && (
                      <>
                        <Textarea
                          aria-label={t('return.serialsRow', { row: r.lineNo })}
                          aria-invalid={serialRow || undefined}
                          rows={2}
                          value={r.serialsText}
                          className="font-code text-xs"
                          onChange={(e) => update(i, { serialsText: e.target.value })}
                        />
                        {serialRow && (
                          <p role="alert" className="pt-0.5 text-2xs text-danger">
                            {t('validation.serialCount')}
                          </p>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {source.kind === 'invoice' && selected.length > 0 && (
        <p className="text-right text-sm" data-testid="return-value">
          {t('return.estimatedDebit', {
            amount: money(selectionValue(rows), locale, source.currency),
          })}
        </p>
      )}
    </div>
  )
}
