import { useState } from 'react'
import { useParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadError, VersionConflictAlert } from '../../shared/components/common'
import { SalesDocumentEditor } from '../../shared/components/SalesDocumentEditor'
import { SalesDocumentView } from '../../shared/components/SalesDocumentView'
import { useQuote } from '../../shared/hooks/queries'
import { QuoteActions } from '../components/QuoteActions'

/** /sales/quotes/new and /sales/quotes/:id: drafts open in the editor, the rest read-only. */
export function QuotePage() {
  const { id } = useParams()
  const quote = useQuote(id)
  const [conflict, setConflict] = useState(false)
  // A draft being edited stays in the editor if a refetch reports it sent elsewhere.
  const [editing, setEditing] = useState<string | null>(null)
  const data = quote.data
  if (data?.status === 'draft' && editing !== data.id) setEditing(data.id)
  const inEditor = data !== undefined && (data.status === 'draft' || editing === data.id)

  const reload = async () => {
    const fresh = (await quote.refetch()).data
    if (fresh && fresh.status !== 'draft') setEditing(null)
    setConflict(false)
    return fresh
  }

  if (!id) {
    return (
      <SalesDocumentEditor
        kind="quote"
        document={null}
        onReload={() => Promise.resolve(undefined)}
      />
    )
  }
  if (data && inEditor) {
    return (
      <SalesDocumentEditor
        key={data.id}
        kind="quote"
        document={data}
        onReload={reload}
        actions={({ ensureSaved, busy }) => (
          <QuoteActions
            quote={data}
            ensureSaved={ensureSaved}
            busy={busy}
            // The newer version reaches the editor, which then offers the reload.
            onConflict={() => void quote.refetch()}
            onDone={() => setEditing(null)}
          />
        )}
      />
    )
  }
  if (data) {
    return (
      <SalesDocumentView
        kind="quote"
        document={data}
        banner={conflict ? <VersionConflictAlert onReload={() => void reload()} /> : undefined}
        actions={<QuoteActions quote={data} onConflict={() => setConflict(true)} />}
      />
    )
  }
  if (quote.isPending) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <LoadError error={quote.error} onRetry={() => void quote.refetch()} />
    </div>
  )
}
