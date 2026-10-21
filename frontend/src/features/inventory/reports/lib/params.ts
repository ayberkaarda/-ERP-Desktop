import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { ColDef, ReportDef, Row } from '../definitions'

/** Report parameters as flat strings: URL- and preset-friendly. */
export type ParamRecord = Record<string, string>

export const paramKeys = (def: ReportDef) => def.params.map((p) => p.key)

/** A fresh form: initial values of the parameters that have one. */
export function initialParams(def: ReportDef): ParamRecord {
  return Object.fromEntries(def.params.flatMap((p) => (p.initial ? [[p.key, p.initial()]] : [])))
}

export function missingRequired(def: ReportDef, p: ParamRecord): string[] {
  return def.params.filter((d) => d.required && !p[d.key]).map((d) => d.key)
}

/** What the API gets: known keys with a value (absent ones at their initial), checkboxes 1/0. */
export function apiParams(def: ReportDef, p: ParamRecord): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of def.params) {
    const v = p[d.key] ?? d.initial?.() ?? ''
    if (d.kind === 'checkbox') out[d.key] = v === '1' ? '1' : '0'
    else if (v !== '') out[d.key] = v
  }
  return out
}

export function stringAt(row: Row | null | undefined, key: string): string {
  const v = row?.[key]
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

/**
 * Totals row from the report's meta.totals (computed over every row, not just the page): the
 * `total` columns that the API totals carry.
 */
export function totalsRow(columns: readonly ColDef[], meta?: Row | null): Row | null {
  const api = meta?.totals
  if (api === null || typeof api !== 'object') return null
  const out: Row = {}
  for (const c of columns) {
    const v = stringAt(api as Row, c.key)
    if (c.total && v !== '') out[c.key] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Applied report parameters live in the URL (shareable links, drill-down between reports);
 * only `keys` are read. `ready` is true once any of them is present.
 */
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
      // An all-default form still marks the report as run.
      if ([...out.keys()].length === 0) out.set('run', '1')
      setSearch(out, { replace: true })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setSearch],
  )
  const ready = keys.some((k) => search.has(k)) || search.has('run')
  return { applied, apply, ready }
}
