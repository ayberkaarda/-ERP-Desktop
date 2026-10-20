import type { RouteObject } from 'react-router'

/**
 * Dev-only routes, meant as children of the app shell route. Empty in production builds, so the
 * showcase chunk is never emitted there (import.meta.env.DEV is a build-time constant).
 */
export const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: 'showcase',
        lazy: async () => ({
          Component: (await import('@/features/_showcase/ShowcasePage')).ShowcasePage,
        }),
      },
    ]
  : []
