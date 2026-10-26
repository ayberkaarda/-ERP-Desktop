import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadError } from '@/features/sales/invoices/kit/components/LoadError'
import { useCompanyStore } from '@/stores/company'
import { purchKeys } from '../../invoices/kit/keys'
import { returnsApi } from '../api'
import { ReturnCreate } from '../components/ReturnCreate'
import { ReturnView } from '../components/ReturnView'

/** /purchasing/returns/new?invoice=|receipt= (line selection) and /:id (steps). */
export function ReturnPage() {
  const { t } = useTranslation('purchasing-docs')
  const { id } = useParams()
  const [search] = useSearchParams()
  useCompanyStore((s) => s.activeCompanyId)
  const ret = useQuery({
    queryKey: purchKeys.detail('returns', id ?? ''),
    queryFn: ({ signal }) => returnsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })

  if (!id) {
    const invoice = search.get('invoice')
    const receipt = search.get('receipt')
    if (invoice) return <ReturnCreate kind="invoice" sourceId={invoice} />
    if (receipt) return <ReturnCreate kind="receipt" sourceId={receipt} />
    return (
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <EmptyState description={t('return.pickSource')} />
      </div>
    )
  }
  if (ret.data) return <ReturnView ret={ret.data} onReload={() => void ret.refetch()} />
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
      {ret.isError ? (
        <LoadError error={ret.error} onRetry={() => void ret.refetch()} />
      ) : (
        <>
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-64 w-full" />
        </>
      )}
    </div>
  )
}
