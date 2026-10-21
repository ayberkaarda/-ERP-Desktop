import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import type { CrudApi } from '../api/client'
import { refKeys } from './keys'

/** Query and mutation hooks for a standard collection resource. */
export function createCrudHooks<T, I>(name: string, api: CrudApi<T, I>) {
  function useList(query: ListQueryState) {
    return useQuery({
      queryKey: refKeys.list(name, query),
      queryFn: ({ signal }) => api.list(query, signal),
      placeholderData: keepPreviousData,
    })
  }

  /** Every row (all pages), for selects and trees. */
  function useAll(params?: Record<string, string>) {
    return useQuery({
      queryKey: refKeys.full(name, JSON.stringify(params ?? {})),
      queryFn: ({ signal }) => api.all(params, signal),
      staleTime: 60_000,
    })
  }

  function useCreate() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: ({ input, key }: { input: I; key?: string }) => api.create(input, key),
      onSuccess: () => qc.invalidateQueries({ queryKey: refKeys.resource(name) }),
    })
  }

  function useUpdate() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: ({ id, version, patch }: { id: string; version: number; patch: Partial<I> }) =>
        api.update(id, version, patch),
      onSuccess: () => qc.invalidateQueries({ queryKey: refKeys.resource(name) }),
    })
  }

  function useRemove() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: (id: string) => api.remove(id),
      onSuccess: () => qc.invalidateQueries({ queryKey: refKeys.resource(name) }),
    })
  }

  return { useList, useAll, useCreate, useUpdate, useRemove }
}
