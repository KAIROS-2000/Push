import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminAuditLogPanel } from '@/components/admin-tools'
import { serverApi } from '@/lib/server-api'
import type { AdminAuditLogResponse } from '@/types'

export default async function AdminLogsPage() {
  const logs = await serverApi<AdminAuditLogResponse>(
    '/admin/audit-logs?page=1&page_size=20',
  ).catch(() => null)

  return (
    <AdminAreaShell area="admin" section="logs">
      <AdminAuditLogPanel initialData={logs} />
    </AdminAreaShell>
  )
}
