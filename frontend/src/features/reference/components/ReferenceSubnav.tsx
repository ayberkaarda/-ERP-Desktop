import { NavLink } from 'react-router'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useRefT } from '../i18n'
import { REFERENCE_ROUTES } from '../navigation'

function SubnavLink({ route }: { route: (typeof REFERENCE_ROUTES)[number] }) {
  const t = useRefT()
  const allowed = usePermission(route.permission)
  if (!allowed) return null
  return (
    <li>
      <NavLink
        to={route.path}
        className={({ isActive }) =>
          cn(
            'inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted-foreground hover:bg-surface-sunken hover:text-foreground',
            isActive && 'bg-primary-soft font-medium text-primary-soft-foreground',
          )
        }
      >
        {t(`nav.${route.key}`)}
      </NavLink>
    </li>
  )
}

/** Links between the Reference pages the user may open. */
export function ReferenceSubnav() {
  const t = useRefT()
  return (
    <nav aria-label={t('nav.title')} className="mb-4">
      <ul className="flex flex-wrap gap-1">
        {REFERENCE_ROUTES.map((route) => (
          <SubnavLink key={route.key} route={route} />
        ))}
      </ul>
    </nav>
  )
}
