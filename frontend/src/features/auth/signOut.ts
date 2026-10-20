import { create } from 'zustand'
import { logout, signOutLocally } from './session'

interface SignOutState {
  pending: boolean
  /** Server did not confirm the logout; the dialog offers retry or local sign-out. */
  failed: boolean
  dismiss: () => void
}

export const useSignOutStore = create<SignOutState>()((set) => ({
  pending: false,
  failed: false,
  dismiss: () => set({ failed: false }),
}))

type Navigate = (to: string) => unknown

export async function signOut(navigate: Navigate): Promise<boolean> {
  useSignOutStore.setState({ pending: true })
  try {
    await logout()
    useSignOutStore.setState({ pending: false, failed: false })
    navigate('/login')
    return true
  } catch {
    useSignOutStore.setState({ pending: false, failed: true })
    return false
  }
}

export function signOutHere(navigate: Navigate) {
  signOutLocally()
  useSignOutStore.setState({ failed: false })
  navigate('/login')
}
