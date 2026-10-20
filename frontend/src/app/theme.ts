import { useEffect, useSyncExternalStore } from 'react'
import { useThemeStore, type ThemePreference } from '@/stores/theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribeSystem(callback: () => void) {
  const mql = window.matchMedia(DARK_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

const systemIsDark = () => window.matchMedia(DARK_QUERY).matches

export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useThemeStore((s) => s.theme)
  const dark = useSyncExternalStore(subscribeSystem, systemIsDark, () => false)
  if (theme === 'system') return dark ? 'dark' : 'light'
  return theme
}

/** Keeps <html> class and data attributes in sync with the stored preferences. */
export function useApplyTheme() {
  const resolved = useResolvedTheme()
  const effects = useThemeStore((s) => s.effects)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
  }, [resolved])

  useEffect(() => {
    document.documentElement.dataset.effects = effects
  }, [effects])
}

/** Switches theme through a View Transition cross-fade when the browser and settings allow it. */
export function changeTheme(next: ThemePreference) {
  const { setTheme, effects } = useThemeStore.getState()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (effects === 'off' || reduced || typeof document.startViewTransition !== 'function') {
    setTheme(next)
    return
  }
  document.startViewTransition(() => setTheme(next))
}
