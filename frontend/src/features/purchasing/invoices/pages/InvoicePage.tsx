import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadError } from '@/features/sales/invoices/kit/components/LoadError'
import { NumberDialog } from '@/features/sales/invoices/kit/components/NumberDialog'
import { useCompanyCurrency } from '@/features/sales/invoices/kit/viewKey'
import { InvoiceEditor } from '../components/InvoiceEditor'
import { InvoiceView } from '../components/InvoiceView'
import { emptyInvoice, valuesFromInvoice } from '../lib/lines'
import { useInvoice } from '../queries'

/** /purchasing/invoices/new and /:id — drafts in the editor, the rest read-only. */
export function InvoicePage() {
  const { t } = useTranslation('purchasing-docs')
  const { id } = useParams()
  const invoice = useInvoice(id)
  const currency = useCompanyCurrency()
  const data = invoice.data
  const [booked, setBooked] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  if (data?.status === 'draft' && editing !== data.id) setEditing(data.id)
  const inEditor = data !== undefined && (data.status === 'draft' || editing === data.id)
  const wrap = (node: ReactNode) => <div className="mx-auto max-w-[1600px] px-6 py-6">{node}</div>

  let body
  if (!id) {
    body = (
      <InvoiceEditor
        invoice={null}
        initialValues={emptyInvoice(currency)}
        onReload={() => Promise.resolve(undefined)}
        onBooked={(r) => setBooked(r.invoice.number ?? null)}
      />
    )
  } else if (data && inEditor) {
    body = (
      <InvoiceEditor
        key={data.id}
        invoice={data}
        initialValues={valuesFromInvoice(data)}
        onReload={async () => {
          const fresh = (await invoice.refetch()).data
          if (fresh && fresh.status !== 'draft') setEditing(null)
          return fresh
        }}
        onBooked={(r) => {
          setEditing(null)
          // Pending approval has no number yet.
          if (r.invoice.number) setBooked(r.invoice.number)
        }}
      />
    )
  } else if (data) {
    body = <InvoiceView invoice={data} onReload={() => void invoice.refetch()} />
  } else if (invoice.isPending) {
    body = (
      <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  } else {
    body = wrap(<LoadError error={invoice.error} onRetry={() => void invoice.refetch()} />)
  }

  return (
    <>
      {body}
      <NumberDialog
        number={booked}
        title={t('invoice.bookedTitle')}
        onClose={() => setBooked(null)}
      />
    </>
  )
}
