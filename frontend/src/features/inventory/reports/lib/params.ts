import Decimal from 'decimal.js'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { isDecimal } from '../../documents/lib/quantity'
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

/** What the API gets: known keys with a value, checkboxes as 1/0. */
export function apiParams(def: ReportDef, p: ParamRecord): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of def.params) {
    const v = p[d.key] ?? ''
    if (d.kind === 'checkbox') out[d.key] = v === '1' ? '1' : '0'
    else if (v !== '') out[d.key] = v
  }
  return out
}

/** Nested field of a row ("buckets.d0_30.value"). */
export function valueAt(row: Row | null | undefined, key: string): unknown {
  let node: unknown = row
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

export function stringAt(row: Row | null | undefined, key: string): string {
  const v = valueAt(row, key)
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

/** Totals row: the API's totals where given, otherwise the sum of `total` columns. */
export function totalsRow(
  columns: readonly ColDef[],
  rows: readonly Row[],
  api?: Row | null,
): Row | null {
  const summed = columns.filter((c) => c.total)
  if (summed.length === 0 && !api) return null
  const out: Row = {}
  for (const c of summed) {
    const given = stringAt(api, c.key)
    if (given !== '') {
      setAt(out, c.key, given)
      continue
    }
    const sum = rows.reduce((s, r) => {
      const v = stringAt(r, c.key)
      return isDecimal(v) ? s.plus(v) : s
    }, new Decimal(0))
    setAt(out, c.key, sum.toFixed(c.kind === 'money' ? 2 : 6))
  }
  return out
}

function setAt(row: Row, key: string, value: string) {
  const parts = key.split('.')
  let node: Row = row
  parts.slice(0, -1).forEach((part) => {
    const next = node[part]
    if (next === null || typeof next !== 'object') node[part] = {}
    node = node[part] as Row
  })
  node[parts.at(-1) ?? key] = value
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
