import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'

function guarded(permission: string | string[], children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const entryPage = async () => ({
  Component: (await import('./pages/JournalEntryPage')).JournalEntryPage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const journalRoutes: RouteObject[] = [
  guarded('accounting.entries.view', [
    {
      path: 'accounting/journal-entries',
      lazy: async () => ({
        Component: (await import('./pages/JournalEntryListPage')).JournalEntryListPage,
      }),
    },
    { path: 'accounting/journal-entries/:id', lazy: entryPage },
  ]),
  guarded(
    ['accounting.entries.view', 'accounting.entries.create'],
    [{ path: 'accounting/journal-entries/new', lazy: entryPage }],
  ),
]
