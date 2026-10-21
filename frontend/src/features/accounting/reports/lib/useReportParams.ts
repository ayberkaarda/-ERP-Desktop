import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { ParamRecord } from './params'

/**
 * Applied report parameters live in the URL (shareable links, drill-through from one report
 * to another); only `keys` are read, missing ones take `defaults`.
 */
export function useReportParams(keys: readonly string[], defaults: ParamRecord) {
  const [search, setSearch] = useSearchParams()
  const applied = useMemo(() => {
    const out: ParamRecord = { ...defaults }
    for (const k of keys) {
      const v = search.get(k)
      if (v !== null) out[k] = v
    }
    return out
    // Defaults are config and keys are constant per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  const apply = useCallback(
    (next: ParamRecord) => {
      const out = new URLSearchParams()
      for (const k of keys) if (next[k]) out.set(k, next[k])
      setSearch(out, { replace: true })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setSearch],
  )
  const ready = keys.some((k) => search.has(k))
  return { applied, apply, ready }
}
