import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadError } from '../../invoices/kit/components/LoadError'
import { POSTED_STATUSES } from '../../invoices/types'
import { useInvoice } from '../../invoices/queries'
import { ReturnCreate } from '../components/ReturnCreate'
import { ReturnView } from '../components/ReturnView'
import { useReturn, useReturnedPerLine } from '../queries'

function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/** /sales/returns/new?invoice= (line selection) and /sales/returns/:id (steps). */
export function ReturnPage() {
  const { t } = useTranslation('sales-docs')
  const { id } = useParams()
  const [search] = useSearchParams()
  const invoiceId = id ? undefined : (search.get('invoice') ?? undefined)
  const ret = useReturn(id)
  const invoice = useInvoice(invoiceId)
  const returned = useReturnedPerLine(invoice.data)
  const wrap = (node: ReactNode) => <div className="mx-auto max-w-[1440px] px-6 py-6">{node}</div>

  if (!id) {
    if (!invoiceId) return wrap(<EmptyState description={t('return.pickInvoice')} />)
    if (invoice.data) {
      const inv = invoice.data
      if (inv.invoice_type !== 'sale' || !POSTED_STATUSES.includes(inv.status))
        return wrap(<EmptyState description={t('return.notReturnable')} />)
      if (returned.data)
        return (
          <ReturnCreate
            key={JSON.stringify(returned.data)}
            invoice={inv}
            returned={returned.data}
          />
        )
      if (returned.isError)
        return wrap(<LoadError error={returned.error} onRetry={() => void returned.refetch()} />)
      return <Loading />
    }
    if (invoice.isPending) return <Loading />
    return wrap(<LoadError error={invoice.error} onRetry={() => void invoice.refetch()} />)
  }
  if (ret.data) return <ReturnView ret={ret.data} onReload={() => void ret.refetch()} />
  if (ret.isPending) return <Loading />
  return wrap(<LoadError error={ret.error} onRetry={() => void ret.refetch()} />)
}
