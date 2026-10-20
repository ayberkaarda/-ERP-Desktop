import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ErrorState } from '@/components/shared/ErrorState'

export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <ErrorState variant="notFound" />
  const detail = error instanceof Error && import.meta.env.DEV ? error.message : undefined
  return <ErrorState detail={detail} />
}
