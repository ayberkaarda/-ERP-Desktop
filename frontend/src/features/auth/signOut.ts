import { create } from 'zustand'
import { isPlatformCancelled } from '@/platform'
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
  } catch (error) {
    // The user called it off in the runtime: stay signed in, no failure dialog.
    useSignOutStore.setState({ pending: false, failed: !isPlatformCancelled(error) })
    return false
  }
}

export function signOutHere(navigate: Navigate) {
  signOutLocally()
  useSignOutStore.setState({ failed: false })
  navigate('/login')
}
