import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useParams } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { DocumentView } from '../../documents/components/DocumentView'
import { LoadError } from '../../documents/components/LoadError'
import { PostedDialog } from '../../documents/components/PostedDialog'
import { RefreshFailed } from '../../documents/components/RefreshFailed'
import { useDocument } from '../../documents/hooks/queries'
import { COUNTS_PATH, CountEditor } from '../components/CountEditor'

/** /inventory/counts/:id — a draft count opens the entry grid, a posted one is read-only. */
export function CountPage() {
  const { id } = useParams()
  const { t } = useTranslation('inventoryDocs')
  const doc = useDocument(id)
  const [posted, setPosted] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const data = doc.data
  if (data?.status === 'draft' && editing !== data.id) setEditing(data.id)
  const inEditor = data !== undefined && (data.status === 'draft' || editing === data.id)

  let body
  if (data && data.doc_type !== 'count') {
    body = <Navigate to={`/inventory/documents/${data.id}`} replace />
  } else if (data && inEditor) {
    body = (
      <CountEditor
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
    body = <DocumentView document={data} listLabel={t('count.listTitle')} listPath={COUNTS_PATH} />
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
