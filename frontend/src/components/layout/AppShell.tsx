import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SignOutFailedDialog } from '@/features/auth/components/SignOutFailedDialog'
import { UserMenu } from '@/features/auth/components/UserMenu'
import { CommandPalette } from '@/features/command-palette/CommandPalette'
import { PaletteTrigger } from '@/features/command-palette/PaletteTrigger'
import { CompanySwitcher } from '@/features/company/components/CompanySwitcher'
import { NotificationBell } from '@/features/notifications/components/NotificationBell'
import { useUiStore } from '@/stores/ui'
import { ConnectivityBadge } from './ConnectivityBadge'
import { Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'

// Below lg (1024px, also 1440px at 200% zoom) the rail becomes an off-canvas drawer.
export function AppShell() {
  const { t } = useTranslation()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggle = useUiStore((s) => s.toggleSidebar)
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in lg:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] shadow-lg outline-none lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">{t('nav.main')}</DialogPrimitive.Title>
            <div className="flex-1 [&>aside]:w-full">
              <Sidebar variant="drawer" onNavigate={() => setDrawerOpen(false)} />
            </div>
            <DialogPrimitive.Close
              aria-label={t('common.close')}
              className="absolute top-3 right-3 grid size-control-sm place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-active-foreground"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-topbar shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-surface px-3 py-2 sm:gap-x-3 sm:px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label={t('nav.open')}
            aria-expanded={drawerOpen}
          >
            <Menu className="text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden lg:inline-flex"
            onClick={toggle}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {collapsed ? (
              <PanelLeftOpen className="text-muted-foreground" />
            ) : (
              <PanelLeftClose className="text-muted-foreground" />
            )}
          </Button>
          <div className="min-w-0 flex-1 basis-40 sm:flex-none sm:basis-auto">
            <CompanySwitcher />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <PaletteTrigger />
            <ConnectivityBadge />
            <NotificationBell />
            <ThemeToggle />
            <span className="mx-1 h-5 w-px bg-border sm:mx-1.5" />
            <UserMenu />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette />
      <SignOutFailedDialog />
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
