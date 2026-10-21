/** Report parameters as flat strings: URL- and preset-friendly, converted for the API here. */
export type ParamRecord = Record<string, string>

export function pick(record: ParamRecord, keys: readonly string[]): ParamRecord {
  return Object.fromEntries(keys.flatMap((k) => (record[k] ? [[k, record[k]]] : [])))
}

/** Period or inclusive date range part of a report request. */
export function rangeParams(p: ParamRecord): Record<string, string> {
  if (p.mode === 'period' && p.period_id) return { period_id: p.period_id }
  return pick(p, ['date_from', 'date_to'])
}

export function hasRange(p: ParamRecord): boolean {
  return p.mode === 'period' ? Boolean(p.period_id) : Boolean(p.date_from && p.date_to)
}
