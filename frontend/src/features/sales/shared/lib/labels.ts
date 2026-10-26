import { platform } from '@/platform'
import type { Paginated, SalesLine } from '../types'
import { activeCompany } from './keys'

// The Sales API sends ids only on lines: item code/name, unit codes and the item's base unit are
// read from Catalog (GET /items?filter[id]=, GET /units) and cached per company. A lookup the
// user may not read (items.view) leaves the labels empty instead of failing the document.

interface ItemLabel {
  id: string
  code: string
  name: string
  base_unit_id: string
  type?: 'stock' | 'service'
}

interface UnitLabel {
  id: string
  code: string
}

/** Catalog's limit of ids per filter[id] request. */
export const ITEM_ID_BATCH = 100
const UNITS_TTL = 5 * 60_000

const items = new Map<string, ItemLabel>()
let units: { company: string; at: number; rows: Map<string, UnitLabel> } | null = null

/** Drops every cached label (tests, company switch is handled by the cache keys). */
export function resetLabelCache(): void {
  items.clear()
  units = null
}

const itemKey = (company: string, id: string) => `${company}:${id}`

async function loadUnits(company: string, signal?: AbortSignal): Promise<Map<string, UnitLabel>> {
  if (units?.company === company && Date.now() - units.at < UNITS_TTL) return units.rows
  const rows = new Map<string, UnitLabel>()
  for (let page = 1; page <= 20; page++) {
    const res = await platform.http.get<Paginated<UnitLabel>>('/units', {
      params: { page, per_page: 100 },
      signal,
    })
    for (const u of res.data) rows.set(u.id, { id: u.id, code: u.code })
    if (page >= res.meta.pagination.last_page || res.data.length === 0) break
  }
  units = { company, at: Date.now(), rows }
  return rows
}

async function loadItems(
  company: string,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, ItemLabel>> {
  const out = new Map<string, ItemLabel>()
  const missing: string[] = []
  for (const id of new Set(ids.filter(Boolean))) {
    const cached = items.get(itemKey(company, id))
    if (cached) out.set(id, cached)
    else missing.push(id)
  }
  for (let i = 0; i < missing.length; i += ITEM_ID_BATCH) {
    const chunk = missing.slice(i, i + ITEM_ID_BATCH)
    const res = await platform.http.get<Paginated<ItemLabel>>('/items', {
      params: { 'filter[id]': chunk.join(','), per_page: ITEM_ID_BATCH },
      signal,
    })
    for (const it of res.data) {
      const label = {
        id: it.id,
        code: it.code,
        name: it.name,
        base_unit_id: it.base_unit_id,
        type: it.type,
      }
      items.set(itemKey(company, it.id), label)
      out.set(it.id, label)
    }
  }
  return out
}

/** Lines with item code/name, unit codes and base unit filled in where Catalog answers. */
export async function labelLines<L extends SalesLine>(
  lines: L[],
  signal?: AbortSignal,
): Promise<L[]> {
  if (lines.length === 0) return lines
  const company = activeCompany()
  const [itemMap, unitMap] = await Promise.all([
    loadItems(
      company,
      lines.map((l) => l.item_id),
      signal,
    ).catch(() => new Map<string, ItemLabel>()),
    loadUnits(company, signal).catch(() => new Map<string, UnitLabel>()),
  ])
  return lines.map((l) => {
    const item = itemMap.get(l.item_id)
    const baseUnit = item?.base_unit_id ?? l.base_unit_id ?? null
    return {
      ...l,
      item_code: l.item_code ?? item?.code ?? null,
      item_name: l.item_name ?? item?.name ?? null,
      item_type: l.item_type ?? item?.type ?? null,
      unit_code: l.unit_code ?? unitMap.get(l.unit_id)?.code ?? null,
      base_unit_id: baseUnit,
      base_unit_code: l.base_unit_code ?? (baseUnit ? (unitMap.get(baseUnit)?.code ?? null) : null),
    }
  })
}
