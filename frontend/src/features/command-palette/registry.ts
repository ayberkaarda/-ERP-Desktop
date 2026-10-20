import type { TFunction } from 'i18next'
import type { LucideIcon } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { hasPermission, usePermissionContext, type PermissionRequirement } from '@/lib/permissions'

export type CommandGroup = 'navigation' | 'actions' | 'company' | 'preferences'

export interface CommandContext {
  navigate: (to: string) => void
}

export interface Command {
  /** Unique; registering the same id again replaces the earlier command. */
  id: string
  group: CommandGroup
  title: (t: TFunction) => string
  keywords?: (t: TFunction) => string[]
  icon?: LucideIcon
  /** Hidden unless the active company grants it (super admins see everything). */
  permission?: PermissionRequirement
  run: (ctx: CommandContext) => void | Promise<void>
}

const commands = new Map<string, Command>()
const listeners = new Set<() => void>()
let snapshot: readonly Command[] = []

function emit() {
  snapshot = [...commands.values()]
  listeners.forEach((l) => l())
}

/** Modules add their palette entries here; the returned function removes them again. */
export function registerCommands(list: readonly Command[]): () => void {
  for (const c of list) commands.set(c.id, c)
  emit()
  return () => {
    let changed = false
    for (const c of list) {
      if (commands.get(c.id) === c) {
        commands.delete(c.id)
        changed = true
      }
    }
    if (changed) emit()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => snapshot

export function useRegisteredCommands(): readonly Command[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Registered commands the current user may run in the active company. */
export function useAvailableCommands(): Command[] {
  const all = useRegisteredCommands()
  const ctx = usePermissionContext()
  return all.filter((c) => hasPermission(ctx, c.permission))
}
