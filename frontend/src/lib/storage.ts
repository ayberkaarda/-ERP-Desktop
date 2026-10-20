import { createJSONStorage, type StateStorage } from 'zustand/middleware'

/**
 * localStorage that never throws (private mode, quota, blocked site data). Falls back to an
 * in-memory map so preferences still work for the session.
 */
export function createSafeStorage(getBacking: () => Storage | undefined = defaultBacking) {
  const memory = new Map<string, string>()
  const storage: StateStorage = {
    getItem(name) {
      try {
        const value = getBacking()?.getItem(name)
        if (value != null) return value
      } catch {
        // fall through to memory
      }
      return memory.get(name) ?? null
    },
    setItem(name, value) {
      memory.set(name, value)
      try {
        getBacking()?.setItem(name, value)
      } catch {
        // memory copy already holds the value
      }
    },
    removeItem(name) {
      memory.delete(name)
      try {
        getBacking()?.removeItem(name)
      } catch {
        // nothing else to clean up
      }
    },
  }
  return storage
}

function defaultBacking(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

export const safeStorage = createSafeStorage()

/** JSON storage for zustand `persist`. */
export const safeJSONStorage = createJSONStorage(() => safeStorage)
