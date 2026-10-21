import { Printer, Undo2, RotateCcw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import type { Invoice } from '../api'
import { DocLinks } from '../kit/components/DocLinks'
import { BalanceBadge, InvoiceStatusBadge } from '../kit/components/StatusBadges'
import { INVOICES_BASE, RETURNS_BASE, linkTo } from '../kit/links'
import { dec, money, percent, qty } from '../kit/money'
import { SALES_PERMS } from '../kit/permissions'
import { useCompanyCurrency } from '../kit/viewKey'
import { POSTED_STATUSES } from '../types'
import { ReverseInvoiceDialog } from './ReverseInvoiceDialog'
import { TotalsPanel } from './TotalsPanel'

interface InvoiceViewProps {
  invoice: Invoice
  onReload: () => void
}

/** Issued, pending, reversed or cancelled invoice: balance, journal link, chain and actions. */
export function InvoiceView({ invoice: inv, onReload }: InvoiceViewProps) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const canReverse = usePermission(SALES_PERMS.invoices.reverse)
  const canReturn = usePermission(SALES_PERMS.returns.create)
  const canJournal = usePermission(SALES_PERMS.journalView)
  const [reversing, setReversing] = useState(false)
  const companyCurrency = useCompanyCurrency()
  const posted = POSTED_STATUSES.includes(inv.status)
  // Paid amounts are settled by treasury; reversing those needs the payments undone first.
  const reversible = inv.status === 'issued' && dec(inv.paid_amount).isZero()
  const returnable = posted && inv.invoice_type === 'sale'
  const cur = inv.currency_code
  const hasDiscount = inv.lines.some(
    (l) => !dec(l.discount_percent).isZero() || !dec(l.discount_amount).isZero(),
  )

  const journal = (id: string, label: string) =>
    canJournal ? (
      <Link to={linkTo('journal_entry', id)} className="text-primary hover:underline">
        {label}
      </Link>
    ) : (
      label
    )

  const facts: [string, ReactNode][] = [
    [t('fields.customer'), inv.party_snapshot?.name ?? inv.party_name ?? ''],
    [t('fields.invoiceType'), t(`invoiceType.${inv.invoice_type}`)],
    [t('fields.documentDate'), formatDate(inv.document_date, locale)],
  ]
  if (inv.due_date) facts.push([t('fields.dueDate'), formatDate(inv.due_date, locale)])
  if (inv.party_snapshot?.tax_number)
    facts.push([
      t('fields.taxNumber'),
      `${inv.party_snapshot.tax_office ?? ''} ${inv.party_snapshot.tax_number}`.trim(),
    ])
  if (inv.fx_rate !== '1') facts.push([t('fields.fxRate'), qty(inv.fx_rate, locale)])
  if (inv.issued_at) facts.push([t('fields.issuedAt'), formatDateTime(inv.issued_at, locale)])
  if (inv.journal_entry_id)
    facts.push([t('fields.journalEntry'), journal(inv.journal_entry_id, t('view.journalEntry'))])
  if (inv.reversal_journal_entry_id)
    facts.push([
      t('fields.reversalEntry'),
      journal(inv.reversal_journal_entry_id, t('view.journalEntry')),
    ])
  if (inv.reversal_reason) facts.push([t('fields.reversalReason'), inv.reversal_reason])
  if (inv.notes) facts.push([t('fields.notes'), inv.notes])

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1'
  const tdr = `${td} text-right tabular-nums`

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
      <PageHeader
        title={t('invoice.viewTitle', {
          type: t(`invoiceType.${inv.invoice_type}`),
          number: inv.number ?? '',
        })}
        breadcrumbs={[
          { label: t('nav.sales') },
          { label: t('invoice.listTitle'), to: INVOICES_BASE },
          { label: inv.number ?? t('links.unnumbered') },
        ]}
        meta={
          <span className="flex items-center gap-2">
            <InvoiceStatusBadge status={inv.status} />
            {posted && <BalanceBadge total={inv.total} balanceDue={inv.balance_due} />}
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
          paidAmount={posted ? inv.paid_amount : null}
          balanceDue={posted ? inv.balance_due : null}
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
              <th className={thr}>{t('fields.lineTotal')}</th>
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
                <td className={tdr}>{money(l.line_total, locale, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DocLinks links={inv.links} />
      {inv.audit && inv.audit.length > 0 && <AuditTrail entries={inv.audit} />}
      <ReverseInvoiceDialog
        invoice={inv}
        open={reversing}
        onOpenChange={setReversing}
        onReload={onReload}
      />
    </div>
  )
}
