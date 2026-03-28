import { DashboardView } from '@/components/dashboard-view'
import { SiteHeader } from '@/components/site-header'

export default function DashboardPage() {
  return (
    <main>
      <SiteHeader />
      <div className="page-shell mx-auto max-w-7xl">
        <DashboardView />
      </div>
    </main>
  )
}
