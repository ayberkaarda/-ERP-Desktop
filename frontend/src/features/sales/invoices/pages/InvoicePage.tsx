import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { InvoiceEditor } from '../components/InvoiceEditor'
import { InvoiceView } from '../components/InvoiceView'
import { LoadError } from '../kit/components/LoadError'
import { NumberDialog } from '../kit/components/NumberDialog'
import { useCompanyCurrency } from '../kit/viewKey'
import { emptyInvoice, valuesFromInvoice } from '../lib/lines'
import { useInvoice } from '../queries'

/** /sales/invoices/new and /:id — drafts in the editor, the rest read-only. */
export function InvoicePage() {
  const { t } = useTranslation('sales-docs')
  const { id } = useParams()
  const invoice = useInvoice(id)
  const currency = useCompanyCurrency()
  const data = invoice.data
  const [issued, setIssued] = useState<string | null>(null)
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
        onIssued={(inv) => setIssued(inv.number ?? '')}
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
        onIssued={(inv) => {
          setEditing(null)
          if (inv.number) setIssued(inv.number)
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
        number={issued}
        title={t('invoice.issuedTitle')}
        onClose={() => setIssued(null)}
      />
    </>
  )
}
