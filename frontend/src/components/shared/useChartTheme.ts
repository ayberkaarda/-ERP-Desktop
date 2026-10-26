import { useSyncExternalStore } from 'react'

const TOKENS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-grid',
  'muted-foreground',
  'border',
  'surface-raised',
] as const

type ChartColors = Record<(typeof TOKENS)[number], string>

const cache = new Map<string, ChartColors>()

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

// Keyed by <html> class so colors refresh only after the theme class has actually switched.
function getSnapshot(): ChartColors {
  const key = document.documentElement.className
  let colors = cache.get(key)
  if (!colors) {
    const style = getComputedStyle(document.documentElement)
    colors = Object.fromEntries(
      TOKENS.map((t) => [t, style.getPropertyValue(`--${t}`).trim() || 'currentColor']),
    ) as ChartColors
    cache.set(key, colors)
  }
  return colors
}

/** Resolved chart token values; SVG presentation attributes cannot reliably resolve var(). */
export function useChartTheme(): ChartColors {
  return useSyncExternalStore(subscribe, getSnapshot)
}
