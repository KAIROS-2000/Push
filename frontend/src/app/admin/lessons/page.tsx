import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminLessonsPanel } from '@/components/admin-tools'
import { serverApi } from '@/lib/server-api'
import type { ModuleItem } from '@/types'

export default async function AdminLessonsPage() {
  const modules = await serverApi<{ modules: ModuleItem[] }>('/admin/modules').catch(() => null)

  return (
    <AdminAreaShell area="admin" section="lessons">
      <AdminLessonsPanel initialModules={modules?.modules ?? null} moduleHubHref="/admin/modules" />
    </AdminAreaShell>
  )
}
