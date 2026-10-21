import type { ReactNode } from 'react'
import { PageHeader, type Breadcrumb } from '@/components/shared/PageHeader'
import { ReferenceSubnav } from './ReferenceSubnav'

interface PageShellProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: Breadcrumb[]
  meta?: ReactNode
  children: ReactNode
}

/** Common frame of the Reference pages: section links, header, content. */
export function PageShell({ children, ...header }: PageShellProps) {
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <ReferenceSubnav />
      <PageHeader {...header} />
      {children}
    </div>
  )
}
