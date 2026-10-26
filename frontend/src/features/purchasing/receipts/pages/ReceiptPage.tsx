import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadError } from '@/features/sales/invoices/kit/components/LoadError'
import { NumberDialog } from '@/features/sales/invoices/kit/components/NumberDialog'
import { useCompanyCurrency } from '@/features/sales/invoices/kit/viewKey'
import { ReceiptEditor } from '../components/ReceiptEditor'
import { ReceiptView } from '../components/ReceiptView'
import { emptyReceipt, valuesFromOrder, valuesFromReceipt } from '../lib/lines'
import { useOrderSource, useReceipt } from '../queries'

const Busy = () => (
  <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6" aria-busy="true">
    <Skeleton className="h-10 w-80" />
    <Skeleton className="h-64 w-full" />
  </div>
)

const Wrap = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto max-w-[1600px] px-6 py-6">{children}</div>
)

/**
 * /purchasing/receipts/new[?order=<id>] and /:id — a new receipt from an order (or direct when the
 * company allows it), drafts in the editor, posted and cancelled ones read-only.
 */
export function ReceiptPage() {
  const { t } = useTranslation('purchasing-docs')
  const { id } = useParams()
  const [search] = useSearchParams()
  const receipt = useReceipt(id)
  const orderId = id ? (receipt.data?.order_id ?? null) : search.get('order')
  const order = useOrderSource(orderId)
  const currency = useCompanyCurrency()
  const [posted, setPosted] = useState<string | null>(null)
  const data = receipt.data

  let body
  if (!id) {
    if (orderId && order.isPending) body = <Busy />
    else if (orderId && order.isError)
      body = (
        <Wrap>
          <LoadError error={order.error} onRetry={() => void order.refetch()} />
        </Wrap>
      )
    else
      body = (
        <ReceiptEditor
          key={orderId ?? 'direct'}
          receipt={null}
          order={order.data ?? null}
          initialValues={order.data ? valuesFromOrder(order.data) : emptyReceipt(currency)}
          onReload={() => Promise.resolve(undefined)}
          onPosted={(r) => setPosted(r.number)}
        />
      )
  } else if (data?.status === 'draft') {
    if (data.order_id && order.isPending) body = <Busy />
    else
      body = (
        <ReceiptEditor
          key={`${data.id}-${order.data ? 'o' : 'n'}`}
          receipt={data}
          order={order.data ?? null}
          initialValues={valuesFromReceipt(data, order.data)}
          onReload={async () => (await receipt.refetch()).data}
          onPosted={(r) => setPosted(r.number)}
        />
      )
  } else if (data) {
    body = <ReceiptView receipt={data} onReload={() => void receipt.refetch()} />
  } else if (receipt.isPending) {
    body = <Busy />
  } else {
    body = (
      <Wrap>
        <LoadError error={receipt.error} onRetry={() => void receipt.refetch()} />
      </Wrap>
    )
  }

  return (
    <>
      {body}
      <NumberDialog
        number={posted}
        title={t('receipt.postedTitle')}
        onClose={() => setPosted(null)}
      />
    </>
  )
}
