import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, FileText, Loader2, Printer } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, toIsoDate, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { invoicesApi } from '../../invoices/api'
import { ActionError } from '../../invoices/kit/components/ActionError'
import { DocLinks } from '../../invoices/kit/components/DocLinks'
import { DeliveryStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { usePayloadKeys } from '../../invoices/kit/idempotency'
import { activeCompany, invalidateSalesEffects, salesDocsKeys } from '../../invoices/kit/keys'
import { DELIVERIES_BASE, INVOICES_BASE, linkTo } from '../../invoices/kit/links'
import { money, qty } from '../../invoices/kit/money'
import { SALES_PERMS } from '../../invoices/kit/permissions'
import type { Delivery } from '../api'
import { CancelDeliveryDialog } from './CancelDeliveryDialog'

interface DeliveryViewProps {
  delivery: Delivery
  onReload: () => void
}

/** Posted or cancelled dispatch note: lines with lots/serials, postings, chain, actions. */
export function DeliveryView({ delivery: d, onReload }: DeliveryViewProps) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canCancel = usePermission(SALES_PERMS.deliveries.reverse)
  const canInvoice = usePermission(SALES_PERMS.invoices.create)
  const canJournal = usePermission(SALES_PERMS.journalView)
  const [cancelling, setCancelling] = useState(false)
  const posted = d.status === 'posted'
  const invoiceable = posted && d.invoiced_state !== 'full'
  const hasLot = d.lines.some((l) => l.lot_no)
  const hasSerial = d.lines.some((l) => l.serial_numbers.length > 0)
  const hasCost = d.lines.some((l) => l.unit_cost)

  const invoice = useMutation({
    mutationFn: ({ company }: { company: string }) => {
      const body = { document_date: toIsoDate(new Date()) }
      return invoicesApi.fromDelivery(d.id, body, keyFor({ delivery: d.id, company, ...body }))
    },
    onSuccess: (inv, { company }) => {
      queryClient.setQueryData(salesDocsKeys.detail('invoices', inv.id, company), inv)
      invalidateSalesEffects(queryClient, company)
      keyFor.reset()
      if (activeCompany() !== company) return
      platform.notify.success(t('delivery.invoiceCreated'))
      void navigate(`${INVOICES_BASE}/${inv.id}`)
    },
  })

  const facts: [string, ReactNode][] = [
    [t('fields.customer'), d.party_snapshot?.name ?? d.party_name ?? ''],
    [t('fields.documentDate'), formatDate(d.document_date, locale)],
  ]
  if (d.order_id)
    facts.push([
      t('delivery.order'),
      <Link
        key="o"
        to={linkTo('sales_order', d.order_id)}
        className="font-code text-primary hover:underline"
      >
        {d.order_number ?? t('links.unnumbered')}
      </Link>,
    ])
  if (d.posted_at) facts.push([t('fields.postedAt'), formatDateTime(d.posted_at, locale)])
  if (d.stock_document_id)
    facts.push([
      t('fields.stockDocument'),
      <Link
        key="s"
        to={linkTo('stock_document', d.stock_document_id)}
        className="text-primary hover:underline"
      >
        {t('view.open')}
      </Link>,
    ])
  if (d.journal_entry_id)
    facts.push([
      t('fields.cogsEntry'),
      canJournal ? (
        <Link
          key="j"
          to={linkTo('journal_entry', d.journal_entry_id)}
          className="text-primary hover:underline"
        >
          {t('view.journalEntry')}
        </Link>
      ) : (
        t('view.posted')
      ),
    ])
  if (d.invoiced_state)
    facts.push([t('fields.invoicedState'), t(`invoicedState.${d.invoiced_state}`)])
  if (d.cancel_reason) facts.push([t('fields.cancelReason'), d.cancel_reason])
  if (d.notes) facts.push([t('fields.notes'), d.notes])

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1'
  const tdr = `${td} text-right tabular-nums`

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6">
      <PageHeader
        title={t('delivery.viewTitle', { number: d.number ?? '' })}
        breadcrumbs={[
          { label: t('nav.sales') },
          { label: t('delivery.listTitle'), to: DELIVERIES_BASE },
          { label: d.number ?? t('links.unnumbered') },
        ]}
        meta={<DeliveryStatusBadge status={d.status} />}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={`${DELIVERIES_BASE}/${d.id}/print`}>
                <Printer aria-hidden="true" />
                {t('print.open')}
              </Link>
            </Button>
            {invoiceable && canInvoice && (
              <Button
                type="button"
                disabled={invoice.isPending}
                onClick={() => invoice.mutate({ company: activeCompany() })}
              >
                {invoice.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <FileText aria-hidden="true" />
                )}
                {t('delivery.createInvoice')}
              </Button>
            )}
            {posted && canCancel && (
              <Button type="button" variant="danger" onClick={() => setCancelling(true)}>
                <Ban aria-hidden="true" />
                {t('delivery.cancel')}
              </Button>
            )}
          </>
        }
      />
      <ActionError error={invoice.error} />
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          className="w-full border-separate border-spacing-0 text-table"
          aria-label={t('delivery.lines')}
        >
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th className={thr}>#</th>
              <th className={th}>{t('fields.item')}</th>
              <th className={thr}>{t('fields.quantity')}</th>
              <th className={th}>{t('fields.unit')}</th>
              {hasLot && <th className={th}>{t('fields.lot')}</th>}
              {hasSerial && <th className={th}>{t('fields.serials')}</th>}
              {hasCost && <th className={thr}>{t('fields.unitCost')}</th>}
              <th className={thr}>{t('fields.invoicedQuantity')}</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td className={tdr}>{l.line_no}</td>
                <td className={td}>
                  {l.item_code && <span className="font-code">{l.item_code} </span>}
                  {l.item_name ?? l.description}
                </td>
                <td className={tdr}>{qty(l.quantity, locale)}</td>
                <td className={td}>{l.unit_code ?? ''}</td>
                {hasLot && <td className={`${td} font-code`}>{l.lot_no ?? ''}</td>}
                {hasSerial && <td className={`${td} font-code`}>{l.serial_numbers.join(', ')}</td>}
                {hasCost && <td className={tdr}>{money(l.unit_cost, locale)}</td>}
                <td className={tdr}>{qty(l.invoiced_quantity ?? '0', locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DocLinks links={d.links} />
      {d.audit && d.audit.length > 0 && <AuditTrail entries={d.audit} />}
      <CancelDeliveryDialog
        delivery={d}
        open={cancelling}
        onOpenChange={setCancelling}
        onReload={onReload}
      />
    </div>
  )
}
