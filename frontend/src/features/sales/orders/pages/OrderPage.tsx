import { Clock, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { ApprovalTimeline } from '@/components/shared/ApprovalTimeline'
import { Skeleton } from '@/components/ui/skeleton'
import type { SalesOrder } from '../../shared/api'
import { LoadError, VersionConflictAlert } from '../../shared/components/common'
import { SalesDocumentEditor } from '../../shared/components/SalesDocumentEditor'
import { SalesDocumentView, type ExtraTab } from '../../shared/components/SalesDocumentView'
import { useApproval, useOrder } from '../../shared/hooks/queries'
import { approvalSteps } from '../../shared/lib/approval'
import { OrderActions } from '../components/OrderActions'

function ApprovalPanel({ order }: { order: SalesOrder }) {
  const { t } = useTranslation('sales-orders')
  const approval = useApproval(order.approval_request_id)
  if (approval.isPending) return <Skeleton className="h-24 w-full" />
  if (approval.isError) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('approval.unavailable')}
      </p>
    )
  }
  return <ApprovalTimeline steps={approvalSteps(approval.data)} currency={order.currency_code} />
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'warning' | 'info'
  icon: typeof Clock
  children: string
}) {
  return (
    <p
      role="note"
      className={
        tone === 'warning'
          ? 'flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground'
          : 'flex items-start gap-2 rounded-md border border-border bg-surface-sunken p-3 text-sm'
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

/** /sales/orders/new and /sales/orders/:id: drafts and revisions in the editor, else read-only. */
export function OrderPage() {
  const { t } = useTranslation('sales-orders')
  const { id } = useParams()
  const order = useOrder(id)
  const [conflict, setConflict] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [revising, setRevising] = useState<string | null>(null)
  const data = order.data
  if (data?.status === 'draft' && editing !== data.id) setEditing(data.id)
  const inEditor = data !== undefined && (data.status === 'draft' || editing === data.id)

  const reload = async () => {
    const fresh = (await order.refetch()).data
    if (fresh && fresh.status !== 'draft') setEditing(null)
    setConflict(false)
    return fresh
  }

  if (!id) {
    return (
      <SalesDocumentEditor
        kind="order"
        document={null}
        onReload={() => Promise.resolve(undefined)}
      />
    )
  }
  if (data?.id !== undefined && revising === data.id) {
    return (
      <SalesDocumentEditor
        key={`revise-${data.id}`}
        kind="order"
        mode="revise"
        document={data}
        onReload={reload}
        onRevised={() => setRevising(null)}
        onCancelRevise={() => setRevising(null)}
      />
    )
  }
  if (data && inEditor) {
    return (
      <div>
        {data.approval_comment && (
          <div className="mx-auto max-w-[1440px] px-6 pt-6">
            <Notice tone="warning" icon={ShieldAlert}>
              {t('approval.rejected', { comment: data.approval_comment })}
            </Notice>
          </div>
        )}
        <SalesDocumentEditor
          key={data.id}
          kind="order"
          document={data}
          onReload={reload}
          actions={({ ensureSaved, busy }) => (
            <OrderActions
              order={data}
              ensureSaved={ensureSaved}
              busy={busy}
              onConflict={() => void order.refetch()}
              onDone={() => setEditing(null)}
            />
          )}
        />
      </div>
    )
  }
  if (data) {
    const extraTabs: ExtraTab[] = data.approval_request_id
      ? [{ value: 'approval', label: t('approval.tab'), content: <ApprovalPanel order={data} /> }]
      : []
    return (
      <SalesDocumentView
        kind="order"
        document={data}
        extraTabs={extraTabs}
        banner={
          <>
            {conflict && <VersionConflictAlert onReload={() => void reload()} />}
            {data.status === 'pending_approval' && (
              <Notice tone="warning" icon={Clock}>
                {t('approval.pending')}
              </Notice>
            )}
            {data.credit_override_reason && (
              <Notice tone="info" icon={ShieldAlert}>
                {t('creditOverridden', { reason: data.credit_override_reason })}
              </Notice>
            )}
          </>
        }
        actions={
          <OrderActions
            order={data}
            onConflict={() => setConflict(true)}
            onRevise={() => setRevising(data.id)}
          />
        }
      />
    )
  }
  if (order.isPending) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <LoadError error={order.error} onRetry={() => void order.refetch()} />
    </div>
  )
}
