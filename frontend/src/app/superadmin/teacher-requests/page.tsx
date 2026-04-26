import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminTeacherRequestsPanel } from '@/components/admin-tools'
import { serverApi } from '@/lib/server-api'
import type { AdminTeacherRequestsResponse } from '@/types'

export default async function SuperadminTeacherRequestsPage() {
  const requests = await serverApi<AdminTeacherRequestsResponse>(
    '/admin/teacher-requests?status=pending&page=1&page_size=20',
  ).catch(() => null)

  return (
    <AdminAreaShell area="superadmin" section="teacher-requests">
      <AdminTeacherRequestsPanel initialData={requests} />
    </AdminAreaShell>
  )
}
