import {
  Activity,
  BookOpenText,
  Boxes,
  LayoutDashboard,
  ReceiptText,
  ShoppingBasket,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { KeystoneLogo, KeystoneMark } from '@/components/brand/Logo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'

type NavKey =
  'dashboard' | 'sales' | 'purchasing' | 'inventory' | 'accounting' | 'treasury' | 'hr' | 'health'

interface NavItem {
  key: NavKey
  icon: LucideIcon
  to?: string
}

// Items without `to` are modules scheduled for later phases.
const SECTIONS: { key: 'main' | 'system'; items: NavItem[] }[] = [
  {
    key: 'main',
    items: [
      { key: 'dashboard', icon: LayoutDashboard, to: '/' },
      { key: 'sales', icon: ReceiptText },
      { key: 'purchasing', icon: ShoppingBasket },
      { key: 'inventory', icon: Boxes },
      { key: 'accounting', icon: BookOpenText },
      { key: 'treasury', icon: WalletCards },
      { key: 'hr', icon: UsersRound },
    ],
  },
  { key: 'system', items: [{ key: 'health', icon: Activity, to: '/system/health' }] },
]

const itemClass =
  'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors duration-150'

interface SidebarProps {
  /** 'rail' is the docked desktop column; 'drawer' fills the off-canvas panel on small screens. */
  variant?: 'rail' | 'drawer'
  onNavigate?: () => void
}

export function Sidebar({ variant = 'rail', onNavigate }: SidebarProps) {
  const { t } = useTranslation()
  const railCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const collapsed = variant === 'rail' && railCollapsed

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        variant === 'rail' ? 'h-dvh' : 'h-full',
        'transition-[width] duration-200 ease-standard',
        collapsed ? 'w-16' : 'w-sidebar',
      )}
    >
      <div className="flex h-topbar items-center border-b border-sidebar-border px-4">
        {collapsed ? (
          <KeystoneMark className="mx-auto h-7" archClassName="fill-sidebar-brand" />
        ) : (
          <KeystoneLogo
            className="h-7 text-sidebar-active-foreground"
            archClassName="fill-sidebar-brand"
          />
        )}
      </div>

      <nav aria-label={t('nav.main')} className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
        {SECTIONS.map((section) => (
          <div key={section.key} className="space-y-0.5">
            {!collapsed && (
              <p className="px-2.5 pb-1.5 text-2xs font-medium tracking-[0.08em] text-sidebar-muted uppercase">
                {t(`nav.${section.key}`)}
              </p>
            )}
            {section.items.map((item) => (
              <SidebarItem
                key={item.key}
                item={item}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

function SidebarItem({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const label = t(`nav.${item.key}`)
  const Icon = item.icon

  const body = (
    <>
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && !item.to && (
        <span className="ml-auto text-2xs font-normal text-sidebar-muted">
          {t('common.comingSoon')}
        </span>
      )}
    </>
  )

  const node = item.to ? (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          itemClass,
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-sidebar-active text-sidebar-active-foreground shadow-[inset_2px_0_0_var(--brand-accent)]'
            : 'hover:bg-sidebar-active/60 hover:text-sidebar-active-foreground',
        )
      }
    >
      {body}
    </NavLink>
  ) : (
    <span
      aria-disabled="true"
      aria-label={collapsed ? label : undefined}
      className={cn(itemClass, collapsed && 'justify-center px-0', 'cursor-default opacity-55')}
    >
      {body}
    </span>
  )

  if (!collapsed) return node
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
