import Decimal from 'decimal.js'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { dec, isDecimal } from '../../invoices/kit/money'
import type { ColDef, ReportDef, Row } from '../definitions'

/** Report parameters as flat strings: URL- and preset-friendly. */
export type ParamRecord = Record<string, string>

export const paramKeys = (def: ReportDef) => def.params.map((p) => p.key)

export function initialParams(def: ReportDef): ParamRecord {
  return Object.fromEntries(def.params.flatMap((p) => (p.initial ? [[p.key, p.initial()]] : [])))
}

export function missingRequired(def: ReportDef, p: ParamRecord): string[] {
  return def.params.filter((d) => d.required && !p[d.key]).map((d) => d.key)
}

/** Date ranges must not run backwards. */
export function rangeInvalid(p: ParamRecord): boolean {
  return Boolean(p.date_from && p.date_to && p.date_from > p.date_to)
}

/** What the API gets: known keys with a value (absent ones at their initial). */
export function apiParams(def: ReportDef, p: ParamRecord): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of def.params) {
    const v = p[d.key] ?? d.initial?.() ?? ''
    if (v !== '') out[d.key] = v
  }
  return out
}

export function stringAt(row: Row | null | undefined, key: string): string {
  const v = row?.[key]
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

/**
 * Totals row: the API's meta.totals (over every row) when present, else the sum of the page's
 * money / quantity / integer `total` columns. Percent totals only come from the API.
 */
export function totalsRow(
  columns: readonly ColDef[],
  rows: readonly Row[],
  meta?: Row | null,
): Row | null {
  const api = meta?.totals
  const out: Row = {}
  if (api !== null && typeof api === 'object') {
    for (const c of columns) {
      const v = stringAt(api as Row, c.key)
      if (c.total && v !== '') out[c.key] = v
    }
  } else {
    for (const c of columns) {
      if (!c.total || c.kind === 'percent') continue
      const values = rows.map((r) => stringAt(r, c.key)).filter(isDecimal)
      if (values.length === 0) continue
      out[c.key] = values.reduce((acc, v) => acc.plus(dec(v)), new Decimal(0)).toString()
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Applied parameters live in the URL (shareable, back/forward); `ready` once any is present. */
export function useReportParams(keys: readonly string[]) {
  const [search, setSearch] = useSearchParams()
  const applied = useMemo(() => {
    const out: ParamRecord = {}
    for (const k of keys) {
      const v = search.get(k)
      if (v !== null) out[k] = v
    }
    return out
    // keys are constant per report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  const apply = useCallback(
    (next: ParamRecord) => {
      const out = new URLSearchParams()
      for (const k of keys) if (next[k]) out.set(k, next[k])
      if ([...out.keys()].length === 0) out.set('run', '1')
      setSearch(out, { replace: true })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setSearch],
  )
  const ready = keys.some((k) => search.has(k)) || search.has('run')
  return { applied, apply, ready }
}
