import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { partyKeys } from '../api/keys'
import { subresourceApi, type SubresourceKind } from '../api/parties'
import { useCompanyId } from './useParties'

export interface SubRow {
  id: string
  version?: number
}

export interface DefaultRule<T> {
  /** Boolean column that only one row (per scope) may hold. */
  flag: keyof T & string
  /** Rows sharing a scope compete for the flag (addresses: per type). */
  scope?: (row: T) => string
}

/** The server clears the flag on siblings; mirror it so the list never shows two defaults. */
export function applySingleDefault<T extends SubRow>(
  rows: T[],
  saved: T,
  rule: DefaultRule<T> | undefined,
): T[] {
  const exists = rows.some((r) => r.id === saved.id)
  const next = exists ? rows.map((r) => (r.id === saved.id ? saved : r)) : [...rows, saved]
  if (!rule || saved[rule.flag] !== true) return next
  const scope = rule.scope?.(saved)
  return next.map((r) =>
    r.id !== saved.id && r[rule.flag] === true && rule.scope?.(r) === scope
      ? { ...r, [rule.flag]: false }
      : r,
  )
}

export function useSubresource<T extends SubRow>(
  partyId: string,
  kind: SubresourceKind,
  rule?: DefaultRule<T>,
) {
  const queryClient = useQueryClient()
  const companyId = useCompanyId()
  const key = partyKeys.sub(companyId, partyId, kind)

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => subresourceApi.list<T>(partyId, kind, signal),
  })

  const store = (saved: T) => {
    queryClient.setQueryData<T[]>(key, (old) => applySingleDefault(old ?? [], saved, rule))
    void queryClient.invalidateQueries({ queryKey: key })
  }

  const create = useMutation({
    mutationFn: ({ input, idemKey }: { input: unknown; idemKey: string }) =>
      subresourceApi.create<T>(partyId, kind, input, idemKey),
    onSuccess: store,
  })

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: unknown }) =>
      subresourceApi.update<T>(partyId, kind, id, input),
    onSuccess: store,
  })

  const remove = useMutation({
    mutationFn: (id: string) => subresourceApi.remove(partyId, kind, id),
    onSuccess: (_d, id) => {
      queryClient.setQueryData<T[]>(key, (old) => (old ?? []).filter((r) => r.id !== id))
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  return { query, create, update, remove, refresh }
}
