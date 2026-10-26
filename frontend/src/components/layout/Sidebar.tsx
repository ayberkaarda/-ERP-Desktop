import { useTranslation } from 'react-i18next'
import { NavLink, useMatch } from 'react-router'
import { KeystoneLogo, KeystoneMark } from '@/components/brand/Logo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hasPermission, usePermissionContext } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'
import { NAV_SECTIONS, type NavItem, type NavSection } from './navigation'

const itemClass =
  'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors duration-150'

interface SidebarProps {
  /** 'rail' is the docked desktop column; 'drawer' fills the off-canvas panel on small screens. */
  variant?: 'rail' | 'drawer'
  onNavigate?: () => void
}

/** Sections with the entries the active company may open; empty sections disappear. */
function useVisibleSections(): NavSection[] {
  const permissions = usePermissionContext()
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.permission === undefined || hasPermission(permissions, item.permission),
    ),
  })).filter((section) => section.items.length > 0)
}

export function Sidebar({ variant = 'rail', onNavigate }: SidebarProps) {
  const { t } = useTranslation()
  const railCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const collapsed = variant === 'rail' && railCollapsed
  const sections = useVisibleSections()

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

      <nav
        aria-label={t('nav.main')}
        className={cn('flex-1 overflow-y-auto px-2.5 py-4', collapsed ? 'space-y-3' : 'space-y-5')}
      >
        {sections.map((section, index) => {
          const headingId = `nav-${variant}-${section.key}`
          return (
            <div
              key={section.key}
              role="group"
              aria-labelledby={collapsed ? undefined : headingId}
              aria-label={collapsed ? t(`nav.${section.key}`) : undefined}
              className="space-y-0.5"
            >
              {collapsed ? (
                index > 0 && (
                  <div aria-hidden="true" className="mx-2 mb-3 border-t border-sidebar-border" />
                )
              ) : (
                <p
                  id={headingId}
                  className="px-2.5 pb-1.5 text-2xs font-medium tracking-[0.08em] text-sidebar-muted uppercase"
                >
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
          )
        })}
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
  // A string className (not NavLink's function form): TooltipTrigger's Slot would stringify a function.
  const isActive = useMatch({ path: item.to ?? '/__unrouted__', end: item.to === '/' }) !== null

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
      className={cn(
        itemClass,
        collapsed && 'justify-center px-0',
        isActive
          ? 'bg-sidebar-active text-sidebar-active-foreground shadow-[inset_2px_0_0_var(--brand-accent)]'
          : 'hover:bg-sidebar-active/60 hover:text-sidebar-active-foreground',
      )}
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
