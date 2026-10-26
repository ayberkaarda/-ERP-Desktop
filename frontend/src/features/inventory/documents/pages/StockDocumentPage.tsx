import { useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { DocumentEditor } from '../components/DocumentEditor'
import { DocumentView } from '../components/DocumentView'
import { LoadError } from '../components/LoadError'
import { PostedDialog } from '../components/PostedDialog'
import { RefreshFailed } from '../components/RefreshFailed'
import { useDocument } from '../hooks/queries'
import { EDITABLE_DOC_TYPES, type EditableDocType } from '../types'

/** /inventory/documents/new?type= and /:id — drafts open in the editor, the rest read-only. */
export function StockDocumentPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const doc = useDocument(id)
  const [posted, setPosted] = useState<string | null>(null)
  // The draft being edited stays in the editor if a refetch reports it posted elsewhere:
  // unmounting would drop unsaved edits; the editor shows the change and offers a reload.
  const [editing, setEditing] = useState<string | null>(null)
  const data = doc.data
  if (data?.status === 'draft' && editing !== data.id) setEditing(data.id)
  const inEditor = data !== undefined && (data.status === 'draft' || editing === data.id)
  const requested = search.get('type')
  const initialType: EditableDocType = EDITABLE_DOC_TYPES.find((x) => x === requested) ?? 'receipt'

  let body
  if (!id) {
    body = (
      <DocumentEditor
        key={initialType}
        document={null}
        initialType={initialType}
        onReload={() => Promise.resolve(undefined)}
        onPosted={(p) => setPosted(p.number ?? '')}
      />
    )
  } else if (data?.doc_type === 'count' && data.status === 'draft') {
    // Count drafts have their own workflow.
    body = <Navigate to={`/inventory/counts/${data.id}`} replace />
  } else if (data && inEditor) {
    body = (
      <DocumentEditor
        key={data.id}
        document={data}
        onReload={async () => {
          const fresh = (await doc.refetch()).data
          if (fresh && fresh.status !== 'draft') setEditing(null)
          return fresh
        }}
        onPosted={(p) => {
          setEditing(null)
          setPosted(p.number ?? '')
        }}
      />
    )
  } else if (data) {
    body = <DocumentView document={data} />
  } else if (doc.isPending) {
    body = (
      <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  } else {
    body = (
      <div className="mx-auto max-w-[1440px] px-6 py-6">
        <LoadError error={doc.error} onRetry={() => void doc.refetch()} />
      </div>
    )
  }

  return (
    <>
      {doc.isError && data !== undefined && <RefreshFailed onRetry={() => void doc.refetch()} />}
      {body}
      <PostedDialog number={posted} onClose={() => setPosted(null)} />
    </>
  )
}
