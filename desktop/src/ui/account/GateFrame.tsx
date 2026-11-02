import type { ReactNode } from 'react'

import { KeystoneLogo, KeystoneMark } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

/** Page frame of the screens the gate shows instead of the web app. */
export function GateFrame({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-12" data-testid={testId}>
      <header className="flex items-center justify-between">
        <KeystoneLogo className="h-8 text-foreground" />
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 py-12">{children}</main>
    </div>
  )
}

export function Splash({ text }: { text: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6" data-testid="account-splash">
      <div className="flex flex-col items-center gap-4 text-center">
        <KeystoneMark className="h-10 animate-pulse" />
        <p role="status" className="text-sm text-muted-foreground">
          {text}
        </p>
      </div>
    </div>
  )
}

/** Inline, announced error. */
export function ErrorLine({ message, children }: { message: string | null; children?: ReactNode }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground"
    >
      <span>{message}</span>
      {children}
    </div>
  )
}
