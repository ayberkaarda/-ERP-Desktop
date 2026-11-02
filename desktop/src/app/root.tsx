import { StrictMode, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { RouterProvider } from 'react-router'

import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Providers } from '@/app/providers'

import { AppGate as AccountAppGate } from '../ui/account'

export type AppRouter = ComponentProps<typeof RouterProvider>['router']

/** Wraps the router inside the providers (i18n, query client, tooltips, toasts). */
export type Gate = ComponentType<{ children: ReactNode }>

/**
 * Start-up gate around the router. The web app has no such slot; the desktop
 * one decides between splash, first-run server profile, recovery screens and
 * the web app itself (ui/account).
 */
export const AppGate: Gate = AccountAppGate

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
