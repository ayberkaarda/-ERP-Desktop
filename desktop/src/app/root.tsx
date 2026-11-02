import { StrictMode, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { RouterProvider } from 'react-router'

import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Providers } from '@/app/providers'

export type AppRouter = ComponentProps<typeof RouterProvider>['router']

/** Wraps the router inside the providers (i18n, query client, tooltips, toasts). */
export type Gate = ComponentType<{ children: ReactNode }>

function PassThrough({ children }: { children: ReactNode }) {
  return children
}

/**
 * Start-up gate around the router. The web app has no such slot; the desktop
 * one decides between splash, first-run server profile, recovery screens and
 * the web app itself. P3 sets this to the ui/account AppGate
 * (`import { AppGate } from '../ui/account'`); until then the web app opens.
 */
export const AppGate: Gate = PassThrough

/** The web main.tsx tree, with the desktop gate between Providers and the router. */
export function DesktopRoot({ router, gate: GateComponent = AppGate }: { router: AppRouter; gate?: Gate }) {
  return (
    <StrictMode>
      <ErrorBoundary>
        <Providers>
          <GateComponent>
            <RouterProvider router={router} />
          </GateComponent>
        </Providers>
      </ErrorBoundary>
    </StrictMode>
  )
}
