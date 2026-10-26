import { useQuery } from '@tanstack/react-query'
import { anyOf, usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'

/**
 * Warehouses as the stock screens see them. The master data (code, name, address, locations,
 * negative stock policy, default flag) belongs to Reference (/warehouses); Inventory adds the
 * reservation policy and serves the combined list at GET /stock-warehouses (not paginated),
 * readable with any of the permissions below. Locations are read from Reference
 * (/warehouses/{id}/locations, warehouses.view).
 */
export interface StockWarehouse {
  id: string
  code: string
  name: string
  is_active: boolean
  is_default: boolean
  /** Reference policy: allow | warn | block. */
  negative_stock_policy: 'allow' | 'warn' | 'block'
  allow_negative_stock: boolean
  reservation_policy: 'none' | 'soft' | 'hard'
  /** Version of the inventory settings row (1 before the first change). */
  version: number
  /** Only on GET /stock-warehouses/{id}. */
  has_movements?: boolean
}

export interface WarehouseLocationRef {
  id: string
  warehouse_id: string
  code: string
  name: string
  is_active: boolean
  parent_id: string | null
  type?: 'aisle' | 'rack' | 'shelf' | 'bin'
  barcode?: string | null
  version?: number
}

interface Paged<T> {
  data: T[]
  meta: { pagination: { last_page: number } }
}

export const WAREHOUSE_READ = anyOf(
  'inventory.warehouses.view',
  'inventory.warehouses.manage',
  'inventory.stock.view',
  'inventory.documents.view',
  // Creating a reservation needs a warehouse to pick.
  'inventory.reservations.manage',
)

const seg = (id: string) => encodeURIComponent(id)

export const stockWarehousesApi = {
  list: async (signal?: AbortSignal): Promise<StockWarehouse[]> =>
    (await platform.http.get<{ data: StockWarehouse[] }>('/stock-warehouses', { signal })).data,
  get: async (id: string, signal?: AbortSignal): Promise<StockWarehouse> =>
    (await platform.http.get<{ data: StockWarehouse }>(`/stock-warehouses/${seg(id)}`, { signal }))
      .data,
  updatePolicy: async (
    id: string,
    body: { reservation_policy: StockWarehouse['reservation_policy']; version: number },
  ): Promise<StockWarehouse> =>
    (await platform.http.patch<{ data: StockWarehouse }>(`/stock-warehouses/${seg(id)}`, body))
      .data,
  /** Every location of a warehouse (Reference list, 100 per page, at most 20 pages). */
  locations: async (warehouseId: string, signal?: AbortSignal): Promise<WarehouseLocationRef[]> => {
    const rows: WarehouseLocationRef[] = []
    for (let page = 1; page <= 20; page += 1) {
      const res = await platform.http.get<Paged<WarehouseLocationRef>>(
        `/warehouses/${seg(warehouseId)}/locations`,
        { params: { sort: 'code', page, per_page: 100 }, signal },
      )
      rows.push(...res.data)
      if (page >= res.meta.pagination.last_page || res.data.length === 0) break
    }
    return rows
  },
}

/** Keys under ["inventory", companyId, "warehouses"], shared by every inventory screen. */
export function warehouseKeysFor(company: string | null) {
  const base = ['inventory', company ?? 'no-company', 'warehouses'] as const
  return {
    all: base,
    list: () => [...base, 'list'] as const,
    detail: (id: string) => [...base, 'detail', id] as const,
    locations: (warehouseId: string) => [...base, 'locations', warehouseId] as const,
  }
}

export function useWarehouseKeys() {
  return warehouseKeysFor(useCompanyStore((s) => s.activeCompanyId))
}

/** Whether GET /stock-warehouses is allowed for the user. */
export function useCanReadWarehouses(): boolean {
  return usePermission(WAREHOUSE_READ)
}

/** The company's warehouses (with inventory policy), sorted by code. */
export function useStockWarehouses(enabled = true) {
  const keys = useWarehouseKeys()
  const allowed = useCanReadWarehouses()
  return useQuery({
    queryKey: keys.list(),
    queryFn: ({ signal }) => stockWarehousesApi.list(signal),
    enabled: enabled && allowed,
    staleTime: 60_000,
  })
}

export function useStockWarehouse(id: string | null) {
  const keys = useWarehouseKeys()
  return useQuery({
    queryKey: keys.detail(id ?? ''),
    queryFn: ({ signal }) => stockWarehousesApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

/** Locations of one warehouse; idle until a warehouse is chosen. */
export function useWarehouseLocations(warehouseId: string) {
  const keys = useWarehouseKeys()
  return useQuery({
    queryKey: keys.locations(warehouseId),
    queryFn: ({ signal }) => stockWarehousesApi.locations(warehouseId, signal),
    enabled: warehouseId !== '',
    staleTime: 60_000,
  })
}
