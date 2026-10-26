import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '@/lib/storage'

interface UiState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'keystone.ui', storage: safeJSONStorage },
  ),
)
