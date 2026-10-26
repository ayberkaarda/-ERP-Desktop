import { Outlet } from 'react-router'
import { useEdocScope } from './hooks'
import { SandboxNotice, Tabs } from './ui'
export function Layout() {
  const scope = useEdocScope()
  return (
    <div key={scope.key} className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
      <SandboxNotice />
      <Tabs />
      <Outlet />
    </div>
  )
}
