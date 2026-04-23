import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminUsersPanel } from '@/components/admin-tools'
import { serverApi } from '@/lib/server-api'
import type { AdminUserDirectoryResponse } from '@/types'

export default async function AdminUsersPage() {
  const directory = await serverApi<AdminUserDirectoryResponse>(
    '/admin/users?page=1&page_size=20',
  ).catch(() => null)

  return (
    <AdminAreaShell area="admin" section="users">
      <AdminUsersPanel initialData={directory} />
    </AdminAreaShell>
  )
}
