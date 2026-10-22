import { FileCheck2, FileText, PackageCheck, ReceiptText, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { buildChain, documentPath } from '../lib/insights'
import type { SalesDocumentLink, SalesDocumentType } from '../types'

const ICONS: Record<SalesDocumentType, typeof FileText> = {
  sales_quote: FileText,
  sales_order: FileCheck2,
  sales_delivery: PackageCheck,
  sales_invoice: ReceiptText,
  sales_return: Undo2,
  sales_credit_note: ReceiptText,
}

interface DocumentChainProps {
  current: Omit<SalesDocumentLink, 'direction'>
  links?: readonly SalesDocumentLink[]
  className?: string
}

/**
 * The quote -> order -> delivery -> invoice -> return chain around a document, oldest stage
 * first; every other document links to its page.
 */
export function DocumentChain({ current, links = [], className }: DocumentChainProps) {
  const { t } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const nodes = buildChain(current, links)
  return (
    <ol
      aria-label={t('chain.title')}
      className={cn('flex flex-wrap items-stretch gap-2', className)}
    >
      {nodes.map((n, i) => {
        const Icon = ICONS[n.type]
        const title = `${t(`chain.type.${n.type}`)} ${n.number ?? t('chain.unnumbered')}`
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              {title}
            </span>
            <span className="text-2xs text-muted-foreground">
              {formatDate(n.document_date, locale)} · {t(`chain.status.${statusKey(n.status)}`)}
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

const KNOWN_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
  'cancelled',
  'pending_approval',
  'confirmed',
  'partially_delivered',
  'delivered',
  'partially_invoiced',
  'invoiced',
  'closed',
  'posted',
  'issued',
  'partially_paid',
  'paid',
  'reversed',
  'approved',
  'received',
  'credited',
] as const

type KnownStatus = (typeof KNOWN_STATUSES)[number]

function statusKey(status: string): KnownStatus | 'other' {
  return (KNOWN_STATUSES as readonly string[]).includes(status) ? (status as KnownStatus) : 'other'
}
