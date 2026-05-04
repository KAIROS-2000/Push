import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminUsefulTasks } from '@/components/admin-useful-tasks'

export default function SuperadminUsefulPage() {
  return (
    <AdminAreaShell area="superadmin" section="useful">
      <AdminUsefulTasks />
    </AdminAreaShell>
  )
}
