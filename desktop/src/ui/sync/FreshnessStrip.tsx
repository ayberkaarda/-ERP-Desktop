// Thin strip under the header while the page on screen shows data answered on
// this device: stale, as-of time, partial copy, filters the copy cannot apply.
// Only the API answers the route shows count (sync/pageResources).
// It is rendered from HeaderExtras into a box placed right after the <header>.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'

import { createFreshnessTracker, pageScope, useDesktopText, type Freshness, type OfflineMetaSource } from '../../sync'
import { formatDateTime, useIntlLocale } from '@/lib/datetime'

function hasNews(f: Freshness | null): f is Freshness {
  return f !== null && (f.stale || f.partial || f.asOf !== undefined || f.unsupportedFilters.length > 0)
}

export function FreshnessStrip({ source }: { source: OfflineMetaSource }) {
  const tracker = useMemo(() => createFreshnessTracker(source), [source])
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const { pathname } = useLocation()
  const text = useDesktopText()
  const locale = useIntlLocale()

  useEffect(() => tracker.start(), [tracker])

  // Only the answers of what this page shows describe it (sync/pageResources).
  useEffect(() => {
    tracker.show(pageScope(pathname))
  }, [tracker, pathname])

  // The strip goes into a box right after the header (this component sits inside it).
  const anchor = useCallback((node: HTMLSpanElement | null) => {
    const header = node?.closest('header')
    if (!header) return
    const box = document.createElement('div')
    header.insertAdjacentElement('afterend', box)
    setTarget(box)
    return () => {
      box.remove()
      setTarget(null)
    }
  }, [])

  const freshness = useSyncExternalStore(tracker.subscribe, tracker.current)
  const strip = hasNews(freshness) ? (
    <div
      role="status"
      data-testid="sync-freshness"
      className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border bg-warning-soft px-4 py-1 text-xs text-warning-soft-foreground"
    >
      <span>{text.td('sync.freshness.label')}</span>
      {freshness.stale ? <span data-testid="sync-freshness-stale">{text.td('sync.freshness.stale')}</span> : null}
      {freshness.asOf !== undefined ? (
        <span data-testid="sync-freshness-as-of">
          {text.td('sync.freshness.asOf', { time: formatDateTime(freshness.asOf, locale) })}
        </span>
      ) : null}
      {freshness.partial ? <span data-testid="sync-freshness-partial">{text.td('sync.freshness.partial')}</span> : null}
      {freshness.unsupportedFilters.length > 0 ? (
        <span data-testid="sync-freshness-filters">
          {text.td('sync.freshness.unsupportedFilters', { filters: freshness.unsupportedFilters.join(', ') })}
        </span>
      ) : null}
    </div>
  ) : null

  return (
    <>
      <span ref={anchor} hidden />
      {target ? createPortal(strip, target) : strip}
    </>
  )
}
