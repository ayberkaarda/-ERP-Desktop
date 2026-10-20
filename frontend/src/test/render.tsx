import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { createQueryClient } from '@/lib/queryClient'

/** Renders a page inside the real providers and a memory router. */
export function renderRoute(element: ReactElement, path = '/') {
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '*', element: <p>navigated</p> },
    ],
    { initialEntries: [path] },
  )
  const queryClient = createQueryClient()
  return {
    router,
    ...render(
      <Providers queryClient={queryClient}>
        <RouterProvider router={router} />
      </Providers>,
    ),
  }
}
