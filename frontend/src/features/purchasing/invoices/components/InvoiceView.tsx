import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Printer, RotateCcw, Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { dec, money, percent, qty } from '@/features/sales/invoices/kit/money'
import { useCompanyCurrency } from '@/features/sales/invoices/kit/viewKey'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { invoicesApi } from '../api'
import { DocLinks } from '../kit/components/DocLinks'
import { BalanceBadge, InvoiceStatusBadge, MatchStatusBadge } from '../kit/components/StatusBadges'
import { TotalsPanel } from '../kit/components/TotalsPanel'
import { errorMessage } from '../kit/http'
import { activeCompany, invalidatePurchEffects, purchKeys } from '../kit/keys'
import { INVOICES_BASE, RETURNS_BASE, linkTo } from '../kit/links'
import { PURCH_PERMS } from '../kit/permissions'
import { BOOKED_STATUSES, type Invoice } from '../types'
import { MatchPanel } from './MatchPanel'
import { ReverseInvoiceDialog } from './ReverseInvoiceDialog'

interface InvoiceViewProps {
  invoice: Invoice
  onReload: () => void
}

/** Booked, pending, reversed or cancelled invoice: payable, journal, match, chain and actions. */
export function InvoiceView({ invoice: inv, onReload }: InvoiceViewProps) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canReverse = usePermission(PURCH_PERMS.invoices.reverse)
  const canReturn = usePermission(PURCH_PERMS.returns.create)
  const canCancel = usePermission(PURCH_PERMS.invoices.update)
  const canJournal = usePermission(PURCH_PERMS.journalView)
  const companyCurrency = useCompanyCurrency()
  const [reversing, setReversing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const booked = BOOKED_STATUSES.includes(inv.status)
  const debit = inv.invoice_type === 'return'
  // Payments are settled by treasury; reversing those needs them undone first.
  const reversible = inv.status === 'booked' && dec(inv.paid_amount).isZero()
  const returnable = booked && !debit
  const cur = inv.currency_code
  const typeLabel = t(`invoiceType.${inv.invoice_type}`)
  const hasDiscount = inv.lines.some(
    (l) => !dec(l.discount_percent).isZero() || !dec(l.discount_amount).isZero(),
  )
  const hasWithholding = !dec(inv.withholding_total).isZero()

  const cancel = useMutation({
    mutationFn: ({ version }: { version: number; company: string }) =>
      invoicesApi.cancel(inv.id, version, keyFor({ id: inv.id, action: 'cancel', version })),
    onSuccess: (saved, { company }) => {
      keyFor.reset()
      queryClient.setQueryData(purchKeys.detail('invoices', saved.id, company), saved)
      invalidatePurchEffects(queryClient, company)
      if (activeCompany() === company) platform.notify.success(t('invoice.cancelled'))
    },
  })

  const journal = (id: string) =>
    canJournal ? (
      <Link to={linkTo('journal_entry', id)} className="text-primary hover:underline">
        {t('view.journalEntry')}
      </Link>
    ) : (
      t('view.journalEntry')
    )

  const facts: [string, ReactNode][] = [
    [t('fields.supplier'), inv.party_snapshot.name || (inv.party_name ?? '')],
    [t('fields.invoiceType'), typeLabel],
    [t('fields.supplierInvoiceNo'), inv.supplier_invoice_no ?? '—'],
    [t('fields.documentDate'), formatDate(inv.document_date, locale)],
  ]
  if (inv.due_date) facts.push([t('fields.dueDate'), formatDate(inv.due_date, locale)])
  if (inv.party_snapshot.tax_number)
    facts.push([
      t('fields.taxNumber'),
      `${inv.party_snapshot.tax_office ?? ''} ${inv.party_snapshot.tax_number}`.trim(),
    ])
  if (!dec(inv.fx_rate).equals(1)) facts.push([t('fields.fxRate'), qty(inv.fx_rate, locale)])
  if (inv.booked_at) facts.push([t('fields.bookedAt'), formatDateTime(inv.booked_at, locale)])
  if (inv.journal_entry_id) facts.push([t('fields.journalEntry'), journal(inv.journal_entry_id)])
  if (inv.reversal_journal_entry_id)
    facts.push([t('fields.reversalEntry'), journal(inv.reversal_journal_entry_id)])
  if (inv.reversal_date)
    facts.push([t('fields.reversalDate'), formatDate(inv.reversal_date, locale)])
  if (inv.reversal_reason) facts.push([t('fields.reversalReason'), inv.reversal_reason])
  if (inv.receive_on_invoice) facts.push([t('invoice.receiveOnInvoice'), t('view.yes')])
  if (inv.notes) facts.push([t('fields.notes'), inv.notes])

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1'
  const tdr = `${td} text-right tabular-nums`

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
      <PageHeader
        title={t('invoice.viewTitle', { type: typeLabel, number: inv.number ?? '' })}
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t('invoice.listTitle'), to: INVOICES_BASE },
          { label: inv.number ?? t('links.unnumbered') },
        ]}
        meta={
          <span className="flex items-center gap-2">
            <InvoiceStatusBadge status={inv.status} />
            {booked && <BalanceBadge payable={inv.payable_total} balanceDue={inv.balance_due} />}
            {inv.match_status && !debit && <MatchStatusBadge status={inv.match_status} />}
          </span>
        }
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={`${INVOICES_BASE}/${inv.id}/print`}>
                <Printer aria-hidden="true" />
                {t('print.open')}
              </Link>
            </Button>
            {returnable && canReturn && (
              <Button asChild variant="secondary">
                <Link to={`${RETURNS_BASE}/new?invoice=${encodeURIComponent(inv.id)}`}>
                  <RotateCcw aria-hidden="true" />
                  {t('invoice.createReturn')}
                </Link>
              </Button>
            )}
            {inv.status === 'pending_approval' && canCancel && (
              <Button type="button" variant="ghost" onClick={() => setCancelling(true)}>
                <Ban aria-hidden="true" />
                {t('invoice.cancel')}
              </Button>
            )}
            {reversible && canReverse && (
              <Button type="button" variant="danger" onClick={() => setReversing(true)}>
                <Undo2 aria-hidden="true" />
                {t('invoice.reverse')}
              </Button>
            )}
          </>
        }
      />
      {inv.status === 'pending_approval' && (
        <p
          role="status"
          className="rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          {t('invoice.pendingApproval')}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <dl className="grid content-start gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <TotalsPanel
          totals={inv}
          currency={cur}
          localCurrency={companyCurrency}
          warnings={inv.warnings}
          payable={inv.payable_total}
          paidAmount={booked ? inv.paid_amount : null}
          balanceDue={booked ? inv.balance_due : null}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          className="w-full border-separate border-spacing-0 text-table"
          aria-label={t('invoice.lines')}
        >
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th className={thr}>#</th>
              <th className={th}>{t('fields.item')}</th>
              <th className={thr}>{t('fields.quantity')}</th>
              <th className={th}>{t('fields.unit')}</th>
              <th className={thr}>{t('fields.unitPrice')}</th>
              {hasDiscount && <th className={thr}>{t('fields.discountPercent')}</th>}
              <th className={thr}>{t('fields.taxRate')}</th>
              <th className={thr}>{t('fields.netAmount')}</th>
              <th className={thr}>{t('fields.taxAmount')}</th>
              {hasWithholding && <th className={thr}>{t('fields.withholding')}</th>}
              <th className={thr}>{t('fields.lineTotal')}</th>
              {!debit && <th className={th}>{t('match.short')}</th>}
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td className={tdr}>{l.line_no}</td>
                <td className={td}>
                  {l.item_code && <span className="font-code">{l.item_code} </span>}
                  {l.description ?? l.item_name}
                </td>
                <td className={tdr}>{qty(l.quantity, locale)}</td>
                <td className={td}>{l.unit_code ?? ''}</td>
                <td className={tdr}>{money(l.unit_price, locale)}</td>
                {hasDiscount && <td className={tdr}>{percent(l.discount_percent, locale)}</td>}
                <td className={tdr}>{percent(l.tax_rate, locale)}</td>
                <td className={tdr}>{money(l.net_amount, locale)}</td>
                <td className={tdr}>{money(l.tax_amount, locale)}</td>
                {hasWithholding && <td className={tdr}>{money(l.withholding_amount, locale)}</td>}
                <td className={tdr}>{money(l.line_total, locale, cur)}</td>
                {!debit && (
                  <td className={td}>
                    {l.match_status && <MatchStatusBadge status={l.match_status} />}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!debit && <MatchPanel match={inv.match} lines={inv.lines} />}
      <DocLinks links={inv.links} />
      {inv.audit && inv.audit.length > 0 && <AuditTrail entries={inv.audit} />}
      <ReverseInvoiceDialog
        invoice={inv}
        open={reversing}
        onOpenChange={setReversing}
        onReload={onReload}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('invoice.cancelTitle')}
        description={t('invoice.cancelBody')}
        confirmLabel={t('invoice.cancel')}
        onConfirm={async () => {
          try {
            await cancel.mutateAsync({ version: inv.version, company: activeCompany() })
          } catch (error) {
            platform.notify.error(errorMessage(error, t('errors.generic')))
            throw error
          }
        }}
      />
    </div>
  )
}
