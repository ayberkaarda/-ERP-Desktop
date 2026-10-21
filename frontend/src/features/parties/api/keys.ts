import type { SubresourceKind } from './parties'

// Company id is part of every key so a company switch never shows another company's cache.
export const partyKeys = {
  all: (companyId: string | null) => ['parties', companyId] as const,
  lists: (companyId: string | null) => [...partyKeys.all(companyId), 'list'] as const,
  list: (companyId: string | null, params: Record<string, string | number>) =>
    [...partyKeys.lists(companyId), params] as const,
  detail: (companyId: string | null, id: string) =>
    [...partyKeys.all(companyId), 'detail', id] as const,
  sub: (companyId: string | null, id: string, kind: SubresourceKind) =>
    [...partyKeys.detail(companyId, id), kind] as const,
  audit: (companyId: string | null, id: string) =>
    [...partyKeys.detail(companyId, id), 'audit'] as const,
  duplicates: (companyId: string | null, taxNumber: string, name: string) =>
    [...partyKeys.all(companyId), 'duplicates', taxNumber, name] as const,
}
