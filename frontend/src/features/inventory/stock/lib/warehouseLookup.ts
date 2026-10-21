import { useMemo } from 'react'
import { useStockWarehouses, type StockWarehouse } from '../../shared/warehouses'

/**
 * Warehouses by id. Ledger, lot and serial rows carry only warehouse_id; the code and name come
 * from GET /stock-warehouses (readable with inventory.stock.view, like these screens).
 */
export function useWarehouseLookup(): (id: string | null | undefined) => StockWarehouse | null {
  const { data } = useStockWarehouses()
  return useMemo(() => {
    const map = new Map((data ?? []).map((w) => [w.id, w]))
    return (id) => (id ? (map.get(id) ?? null) : null)
  }, [data])
}
