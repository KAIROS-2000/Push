import { AdminAreaShell } from '@/components/admin-area-shell'
import { SuperadminAdminsPanel } from '@/components/admin-tools'
import { serverApi } from '@/lib/server-api'
import type { AdminAdminDirectoryResponse } from '@/types'

export default async function SuperadminAdminsPage() {
  const admins = await serverApi<AdminAdminDirectoryResponse>(
    '/admin/admins?page=1&page_size=20',
  ).catch(() => null)

  return (
    <AdminAreaShell area="superadmin" section="admins">
      <SuperadminAdminsPanel initialData={admins} />
    </AdminAreaShell>
  )
}
