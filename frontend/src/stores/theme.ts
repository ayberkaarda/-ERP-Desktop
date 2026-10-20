import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemePreference = 'light' | 'dark' | 'system'
/** Decorative motion/effects level. 'auto' follows prefers-reduced-motion and device capability. */
export type EffectsPreference = 'off' | 'auto' | 'on'

interface ThemeState {
  theme: ThemePreference
  effects: EffectsPreference
  setTheme: (theme: ThemePreference) => void
  setEffects: (effects: EffectsPreference) => void
}

// Key is read by the pre-paint script in index.html to avoid a theme flash.
export const THEME_STORAGE_KEY = 'keystone.theme'

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      effects: 'auto',
      setTheme: (theme) => set({ theme }),
      setEffects: (effects) => set({ effects }),
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ theme, effects }) => ({ theme, effects }),
    },
  ),
)

export function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
