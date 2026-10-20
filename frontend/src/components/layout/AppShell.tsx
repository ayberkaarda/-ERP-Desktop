import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useUiStore } from '@/stores/ui'
import { CompanySwitcher } from './CompanySwitcher'
import { ConnectivityBadge } from './ConnectivityBadge'
import { Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'
import { UserMenu } from './UserMenu'

export function AppShell() {
  const { t } = useTranslation()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggle = useUiStore((s) => s.toggleSidebar)

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          >
            {collapsed ? (
              <PanelLeftOpen className="text-muted-foreground" />
            ) : (
              <PanelLeftClose className="text-muted-foreground" />
            )}
          </Button>
          <CompanySwitcher />
          <div className="ml-auto flex items-center gap-1">
            <ConnectivityBadge />
            <ThemeToggle />
            <span className="mx-1.5 h-5 w-px bg-border" />
            <UserMenu />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
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
