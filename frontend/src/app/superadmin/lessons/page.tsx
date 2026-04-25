import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminLessonsPanel } from '@/components/admin-tools'
import { serverApi } from '@/lib/server-api'
import type { ModuleItem } from '@/types'

export default async function SuperadminLessonsPage() {
  const modules = await serverApi<{ modules: ModuleItem[] }>('/admin/modules').catch(() => null)

  return (
    <AdminAreaShell area="superadmin" section="lessons">
      <AdminLessonsPanel
        initialModules={modules?.modules ?? null}
        moduleHubHref="/superadmin/modules"
      />
    </AdminAreaShell>
  )
}
