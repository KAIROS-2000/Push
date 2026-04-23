import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminModulesPanel } from '@/components/admin-tools'
import { serverApi } from '@/lib/server-api'
import type { ModuleItem } from '@/types'

export default async function AdminModulesPage() {
  const modules = await serverApi<{ modules: ModuleItem[] }>('/admin/modules').catch(() => null)

  return (
    <AdminAreaShell area="admin" section="modules">
      <AdminModulesPanel initialModules={modules?.modules ?? null} />
    </AdminAreaShell>
  )
}
