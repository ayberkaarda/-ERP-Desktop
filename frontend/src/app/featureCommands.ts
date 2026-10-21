import { registerCatalogCommands } from '@/features/catalog/commands'
import { registerPartyCommands } from '@/features/parties/commands'
import { registerReferenceCommands } from '@/features/reference/commands'

let unregister: (() => void) | null = null

/** Adds the feature modules' palette entries; safe to call more than once. */
export function registerFeatureCommands(): () => void {
  if (!unregister) {
    const parts = [registerPartyCommands(), registerCatalogCommands(), registerReferenceCommands()]
    unregister = () => {
      parts.forEach((off) => off())
      unregister = null
    }
  }
  return unregister
}
