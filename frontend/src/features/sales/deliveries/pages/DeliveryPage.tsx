import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { toIsoDate } from '@/lib/datetime'
import { LoadError } from '../../invoices/kit/components/LoadError'
import { NumberDialog } from '../../invoices/kit/components/NumberDialog'
import { DeliveryEditor } from '../components/DeliveryEditor'
import { DeliveryView } from '../components/DeliveryView'
import {
  emptyLine,
  remainingOf,
  valuesFromDelivery,
  valuesFromOrder,
  type DeliveryValues,
} from '../lib/lines'
import { useDelivery, useOrderSource } from '../queries'

function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function emptyDirect(): DeliveryValues {
  return {
    partyId: '',
    partyLabel: '',
    orderId: '',
    documentDate: toIsoDate(new Date()),
    warehouseId: '',
    notes: '',
    lines: [emptyLine()],
  }
}

/** /sales/deliveries/new?order= (or direct) and /:id — drafts in the editor, the rest read-only. */
export function DeliveryPage() {
  const { t } = useTranslation('sales-docs')
  const { id } = useParams()
  const [search] = useSearchParams()
  const orderParam = search.get('order')
  const delivery = useDelivery(id)
  const data = delivery.data
  const order = useOrderSource(id ? (data?.status === 'draft' ? data.order_id : null) : orderParam)
  const [posted, setPosted] = useState<string | null>(null)
  // A draft being edited stays in the editor if a refetch reports it posted elsewhere.
  const [editing, setEditing] = useState<string | null>(null)
  if (data?.status === 'draft' && editing !== data.id) setEditing(data.id)
  const inEditor = data !== undefined && (data.status === 'draft' || editing === data.id)
  const wrap = (node: ReactNode) => <div className="mx-auto max-w-[1440px] px-6 py-6">{node}</div>

  let body
  if (!id) {
    if (orderParam && order.isPending) body = <Loading />
    else if (orderParam && !order.data)
      body = wrap(<LoadError error={order.error} onRetry={() => void order.refetch()} />)
    else
      body = (
        <DeliveryEditor
          key={orderParam ?? 'direct'}
          delivery={null}
          initialValues={order.data ? valuesFromOrder(order.data, '') : emptyDirect()}
          onReload={() => Promise.resolve(undefined)}
          onPosted={(d) => setPosted(d.number ?? '')}
        />
      )
  } else if (data && inEditor) {
    if (data.order_id && order.isPending) body = <Loading />
    else {
      const remaining = Object.fromEntries(
        (order.data?.lines ?? []).map((l) => [l.id, remainingOf(l.quantity, l.delivered_quantity)]),
      )
      body = (
        <DeliveryEditor
          key={`${data.id}-${order.data ? 'o' : '-'}`}
          delivery={data}
          initialValues={valuesFromDelivery(data, remaining)}
          onReload={async () => {
            const fresh = (await delivery.refetch()).data
            if (fresh && fresh.status !== 'draft') setEditing(null)
            return fresh
          }}
          onPosted={(d) => {
            setEditing(null)
            setPosted(d.number ?? '')
          }}
        />
      )
    }
  } else if (data) {
    body = <DeliveryView delivery={data} onReload={() => void delivery.refetch()} />
  } else if (delivery.isPending) {
    body = <Loading />
  } else {
    body = wrap(<LoadError error={delivery.error} onRetry={() => void delivery.refetch()} />)
  }

  return (
    <>
      {body}
      <NumberDialog
        number={posted}
        title={t('delivery.postedTitle')}
        onClose={() => setPosted(null)}
      />
    </>
  )
}
