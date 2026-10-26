import { FileText, Printer, RotateCcw, Undo2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { AuditTrail } from '@/components/shared/AuditTrail'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { money, qty } from '@/features/sales/invoices/kit/money'
import { useCompanyCurrency } from '@/features/sales/invoices/kit/viewKey'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { DocLinks } from '../../invoices/kit/components/DocLinks'
import { ReceiptStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { linkNamed } from '../../invoices/kit/normalize'
import { ORDERS_BASE, RECEIPTS_BASE, RETURNS_BASE, linkTo } from '../../invoices/kit/links'
import { PURCH_PERMS } from '../../invoices/kit/permissions'
import type { Receipt } from '../types'
import { CancelReceiptDialog } from './CancelReceiptDialog'
import { InvoiceFromReceiptDialog } from './InvoiceFromReceiptDialog'

interface ReceiptViewProps {
  receipt: Receipt
  onReload: () => void
}

/** Posted or cancelled receipt: stock and GRNI postings, lots and serials, chain and actions. */
export function ReceiptView({ receipt: r, onReload }: ReceiptViewProps) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const companyCurrency = useCompanyCurrency()
  const canInvoice = usePermission(PURCH_PERMS.invoices.create)
  const canReturn = usePermission(PURCH_PERMS.returns.create)
  const canReverse = usePermission(PURCH_PERMS.receipts.reverse)
  const canJournal = usePermission(PURCH_PERMS.journalView)
  const canStock = usePermission(PURCH_PERMS.stockDocumentView)
  const [reversing, setReversing] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const posted = r.status === 'posted'
  const order = linkNamed(r.raw_links, 'order')
  // A receipt posted by its own invoice (receive on invoice) is invoiced already.
  const invoiceable = posted && r.invoice_id === null

  const linkOr = (allowed: boolean, to: string, label: string) =>
    allowed ? (
      <Link to={to} className="text-primary hover:underline">
        {label}
      </Link>
    ) : (
      label
    )

  const facts: [string, ReactNode][] = [
    [t('fields.supplier'), r.party_snapshot.name || (r.party_name ?? '')],
    [t('fields.documentDate'), formatDate(r.document_date, locale)],
  ]
  if (order)
    facts.push([
      t('fields.order'),
      <Link
        key="o"
        to={`${ORDERS_BASE}/${encodeURIComponent(order.id)}`}
        className="font-code text-primary hover:underline"
      >
        {order.number ?? t('links.unnumbered')}
      </Link>,
    ])
  if (r.supplier_reference) facts.push([t('fields.supplierReference'), r.supplier_reference])
  if (r.posted_at) facts.push([t('fields.postedAt'), formatDateTime(r.posted_at, locale)])
  if (r.stock_document_id)
    facts.push([
      t('fields.stockDocument'),
      linkOr(canStock, linkTo('stock_document', r.stock_document_id), t('view.stockDocument')),
    ])
  if (r.journal_entry_id)
    facts.push([
      t('fields.journalEntry'),
      linkOr(canJournal, linkTo('journal_entry', r.journal_entry_id), t('view.journalEntry')),
    ])
  if (posted || r.reversal_date)
    facts.push([t('fields.costTotal'), money(r.cost_total, locale, companyCurrency)])
  if (r.cancel_reason) facts.push([t('fields.reason'), r.cancel_reason])
  if (r.reversal_date) facts.push([t('fields.reversalDate'), formatDate(r.reversal_date, locale)])
  if (r.reversal_stock_document_id)
    facts.push([
      t('fields.reversalStockDocument'),
      linkOr(
        canStock,
        linkTo('stock_document', r.reversal_stock_document_id),
        t('view.stockDocument'),
      ),
    ])
  if (r.notes) facts.push([t('fields.notes'), r.notes])

  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1 align-top'
  const tdr = `${td} text-right tabular-nums`

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
      <PageHeader
        title={t('receipt.viewTitle', { number: r.number ?? '' })}
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t('receipt.listTitle'), to: RECEIPTS_BASE },
          { label: r.number ?? t('links.unnumbered') },
        ]}
        meta={<ReceiptStatusBadge status={r.status} />}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link to={`${RECEIPTS_BASE}/${r.id}/print`}>
                <Printer aria-hidden="true" />
                {t('print.open')}
              </Link>
            </Button>
            {invoiceable && canInvoice && (
              <Button type="button" variant="secondary" onClick={() => setInvoicing(true)}>
                <FileText aria-hidden="true" />
                {t('receipt.createInvoice')}
              </Button>
            )}
            {posted && canReturn && (
              <Button asChild variant="secondary">
                <Link to={`${RETURNS_BASE}/new?receipt=${encodeURIComponent(r.id)}`}>
                  <RotateCcw aria-hidden="true" />
                  {t('receipt.createReturn')}
                </Link>
              </Button>
            )}
            {posted && canReverse && (
              <Button type="button" variant="danger" onClick={() => setReversing(true)}>
                <Undo2 aria-hidden="true" />
                {t('receipt.reverse')}
              </Button>
            )}
          </>
        }
      />
      <dl className="grid content-start gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
          aria-label={t('receipt.lines')}
        >
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th className={thr}>#</th>
              <th className={th}>{t('fields.item')}</th>
              <th className={thr}>{t('fields.quantity')}</th>
              <th className={th}>{t('fields.unit')}</th>
              <th className={th}>{t('fields.lotNo')}</th>
              <th className={th}>{t('fields.expiryDate')}</th>
              <th className={th}>{t('fields.serials')}</th>
              <th className={thr}>{t('fields.unitCost')}</th>
              <th className={thr}>{t('fields.costTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.id}>
                <td className={tdr}>{l.line_no}</td>
                <td className={td}>
                  {l.item_code && <span className="font-code">{l.item_code} </span>}
                  {l.description ?? l.item_name}
                </td>
                <td className={tdr}>{qty(l.quantity, locale)}</td>
                <td className={td}>{l.unit_code ?? ''}</td>
                <td className={`${td} font-code`}>{l.lot_no ?? ''}</td>
                <td className={td}>{l.expiry_date ? formatDate(l.expiry_date, locale) : ''}</td>
                <td className={`${td} font-code text-xs`}>{l.serial_numbers.join(', ')}</td>
                <td className={tdr}>{l.unit_cost ? money(l.unit_cost, locale) : ''}</td>
                <td className={tdr}>
                  {l.cost_total ? money(l.cost_total, locale, companyCurrency) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DocLinks links={r.links} />
      {r.audit && r.audit.length > 0 && <AuditTrail entries={r.audit} />}
      <CancelReceiptDialog
        receipt={r}
        open={reversing}
        onOpenChange={setReversing}
        onReload={onReload}
      />
      <InvoiceFromReceiptDialog receipt={r} open={invoicing} onOpenChange={setInvoicing} />
    </div>
  )
}
