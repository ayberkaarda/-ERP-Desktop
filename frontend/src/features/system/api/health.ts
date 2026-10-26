import { queryOptions } from '@tanstack/react-query'
import type { GetResponse } from '@/lib/api/types'
import { platform } from '@/platform'

export type HealthResponse = GetResponse<'/health'>

export const healthKeys = {
  all: ['health'] as const,
}

export const healthQuery = () =>
  queryOptions({
    queryKey: healthKeys.all,
    queryFn: ({ signal }) => platform.http.get<HealthResponse>('/health', { signal }),
    retry: false,
    staleTime: 0,
  })
