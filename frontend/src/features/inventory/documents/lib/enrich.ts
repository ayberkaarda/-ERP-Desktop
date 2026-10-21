import type { QueryClient } from '@tanstack/react-query'
import { stockWarehousesApi, warehouseKeysFor } from '../../shared/warehouses'
import { lookupsApi } from '../api/client'
import { activeCompany, invDocsKeys } from '../api/keys'
import type { ItemRef, StockDocument } from '../types'

const LOOKUP_STALE = 5 * 60_000

/**
 * Items by id through the per-item cache (["inventory", c, "docs", "lookups", "item", id]):
 * cached ones are reused, the rest are read in one go and seeded into the cache.
 */
export async function resolveItems(
  queryClient: QueryClient,
  ids: readonly string[],
  company = activeCompany(),
  signal?: AbortSignal,
): Promise<Map<string, ItemRef>> {
  const out = new Map<string, ItemRef>()
  const missing: string[] = []
  for (const id of new Set(ids.filter(Boolean))) {
    const cached = queryClient.getQueryData<ItemRef>(invDocsKeys.item(id, company))
    if (cached) out.set(id, cached)
    else missing.push(id)
  }
  if (missing.length > 0) {
    for (const item of await lookupsApi.itemsByIds(missing, signal)) {
      out.set(item.id, item)
      queryClient.setQueryData(invDocsKeys.item(item.id, company), item)
    }
  }
  return out
}

/**
 * The API sends ids only: labels the lines with the Catalog item (code, name, tracking, expiry,
 * base unit), the unit codes and the location codes of the warehouses involved. A lookup that
 * fails leaves its labels empty instead of failing the document.
 */
export async function enrichDocument(
  queryClient: QueryClient,
  doc: StockDocument,
  company = activeCompany(),
  signal?: AbortSignal,
): Promise<StockDocument> {
  if (doc.lines.length === 0) return doc
  const units = queryClient
    .query({
      queryKey: invDocsKeys.units(company),
      queryFn: ({ signal: s }) => lookupsApi.units(s),
      staleTime: LOOKUP_STALE,
    })
    .catch(() => [])
  const items = resolveItems(
    queryClient,
    doc.lines.map((l) => l.item_id),
    company,
    signal,
  ).catch(() => new Map<string, ItemRef>())
  const locationsOf = (warehouseId: string | null) =>
    warehouseId
      ? queryClient
          .query({
            queryKey: warehouseKeysFor(company).locations(warehouseId),
            queryFn: ({ signal: s }) => stockWarehousesApi.locations(warehouseId, s),
            staleTime: 60_000,
          })
          .catch(() => [])
      : Promise.resolve([])
  const needSource = doc.lines.some((l) => l.location_id)
  const needTarget = doc.lines.some((l) => l.target_location_id)
  const [unitRows, itemMap, source, target] = await Promise.all([
    units,
    items,
    needSource ? locationsOf(doc.warehouse_id) : Promise.resolve([]),
    needTarget ? locationsOf(doc.target_warehouse_id) : Promise.resolve([]),
  ])
  const unitCode = (id: string | null | undefined) =>
    id ? (unitRows.find((u) => u.id === id)?.code ?? null) : null
  return {
    ...doc,
    lines: doc.lines.map((l) => {
      const item = itemMap.get(l.item_id)
      const baseUnitId = item?.base_unit_id ?? l.base_unit_id ?? null
      return {
        ...l,
        item_code: item?.code ?? l.item_code ?? null,
        item_name: item?.name ?? l.item_name ?? null,
        item_tracking: item?.tracking ?? l.item_tracking,
        item_has_expiry: item?.has_expiry ?? l.item_has_expiry,
        base_unit_id: baseUnitId,
        base_unit_code: item?.base_unit?.code ?? unitCode(baseUnitId) ?? l.base_unit_code ?? null,
        unit_code: unitCode(l.unit_id) ?? l.unit_code ?? null,
        location_code: l.location_id
          ? (source.find((x) => x.id === l.location_id)?.code ?? l.location_code ?? null)
          : null,
        target_location_code: l.target_location_id
          ? (target.find((x) => x.id === l.target_location_id)?.code ??
            l.target_location_code ??
            null)
          : null,
      }
    }),
  }
}
