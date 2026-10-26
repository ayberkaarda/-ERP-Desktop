import type { Connectivity } from '../types'

export function createWebConnectivity(): Connectivity {
  return {
    isOnline: () => navigator.onLine,
    subscribe(listener) {
      const on = () => listener(true)
      const off = () => listener(false)
      window.addEventListener('online', on)
      window.addEventListener('offline', off)
      return () => {
        window.removeEventListener('online', on)
        window.removeEventListener('offline', off)
      }
    },
  }
}
