import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
export const assistantRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission="assistant.usage.view" />,
    children: [
      {
        path: 'system/assistant',
        lazy: async () => ({
          Component: (await import('./AssistantAdminPage')).AssistantAdminPage,
        }),
      },
    ],
  },
]
