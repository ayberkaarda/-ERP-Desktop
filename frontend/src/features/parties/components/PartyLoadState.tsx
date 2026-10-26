import type { UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/platform'

/** Loading, not-found and error states shared by the detail and edit pages. */
export function PartyLoadState({ query }: { query: UseQueryResult }) {
  const { t } = useTranslation('parties')
  const { t: tc } = useTranslation('common')
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.status === 404
    return (
      <div role="alert">
        <EmptyState
          title={notFound ? t('detail.notFound') : t('detail.loadFailed')}
          action={
            <div className="flex gap-2">
              {!notFound && (
                <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                  {tc('actions.retry')}
                </Button>
              )}
              <Button asChild variant="ghost" size="sm">
                <Link to="/parties">{t('detail.backToList')}</Link>
              </Button>
            </div>
          }
        />
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4" aria-busy="true">
      <p role="status" className="sr-only">
        {tc('states.loading')}
      </p>
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
