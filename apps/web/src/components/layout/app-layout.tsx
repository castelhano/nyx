import { SidebarProvider } from './sidebar-context'
import { TopbarActionsProvider } from './topbar-actions-context'
import { GlobalShortcuts } from './global-shortcuts'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { KeywatchProvider } from '@/lib/keywatch'

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <KeywatchProvider>
    <TopbarActionsProvider>
    <SidebarProvider>
      <GlobalShortcuts />
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
    </TopbarActionsProvider>
    </KeywatchProvider>
  )
}
