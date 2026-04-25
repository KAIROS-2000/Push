import { serverApi } from '@/lib/server-api'
import { DashboardView } from '@/components/dashboard-view'
import { DashboardData } from '@/types'

export default async function DashboardPage() {
  const initialData = await serverApi<DashboardData>('/dashboard').catch(() => null)

  return (
    <main className="brand-app-shell">
      <div className="page-shell mx-auto w-full max-w-[96rem]">
        <DashboardView initialData={initialData} />
      </div>
    </main>
  )
}
