import {
  ClipboardList,
  FileCheck2,
  FileQuestion,
  PackageCheck,
  ReceiptText,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { buildChain, documentPath } from '../lib/chain'
import type { PurchaseDocumentType, PurchaseLink } from '../types'

const ICONS: Record<PurchaseDocumentType, LucideIcon> = {
  purchase_request: ClipboardList,
  purchase_rfq: FileQuestion,
  purchase_order: FileCheck2,
  purchase_receipt: PackageCheck,
  purchase_invoice: ReceiptText,
  purchase_debit_note: ReceiptText,
  purchase_return: Undo2,
}

const KNOWN = new Set([
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'partially_ordered',
  'ordered',
  'sent',
  'collecting',
  'awarded',
  'partially_received',
  'received',
  'partially_invoiced',
  'invoiced',
  'closed',
  'cancelled',
  'posted',
  'booked',
  'partially_paid',
  'paid',
  'reversed',
  'shipped',
  'debited',
])

/**
 * The request -> RFQ -> order -> receipt -> invoice -> return chain around a document (the same
 * timeline as the sales chain), oldest stage first; every other document links to its page.
 */
export function DocumentChain({
  current,
  links,
  className,
}: {
  current: PurchaseLink
  links: readonly PurchaseLink[]
  className?: string
}) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const nodes = buildChain(current, links)
  return (
    <ol
      aria-label={t('chain.title')}
      className={cn('flex flex-wrap items-stretch gap-2', className)}
    >
      {nodes.map((n, i) => {
        const Icon = ICONS[n.type]
        const status = KNOWN.has(n.status)
          ? t(`chain.status.${n.status}` as 'chain.status.draft')
          : n.status
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              {t(`chain.type.${n.type}`)} {n.number ?? t('common.unnumbered')}
            </span>
            <span className="text-2xs text-muted-foreground">
              {n.document_date ? formatDate(n.document_date, locale) : '—'} · {status}
            </span>
            {n.total && n.currency_code && (
              <span className="text-2xs tabular-nums">
                {formatMoney(n.total, n.currency_code, locale)}
              </span>
            )}
          </>
        )
        return (
          <li
            key={`${n.type}-${n.id}`}
            className="flex items-center gap-2"
            aria-current={n.current ? 'page' : undefined}
          >
            {i > 0 && (
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
            )}
            {n.current ? (
              <div className="flex min-w-36 flex-col gap-0.5 rounded-md border-2 border-primary bg-primary-soft px-3 py-2">
                {body}
              </div>
            ) : (
              <Link
                to={documentPath(n.type, n.id)}
                className="flex min-w-36 flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2 hover:border-border-strong hover:bg-surface-sunken"
              >
                {body}
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}
