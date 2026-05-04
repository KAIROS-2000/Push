import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminUsefulTasks } from '@/components/admin-useful-tasks'

export default function AdminUsefulPage() {
  return (
    <AdminAreaShell area="admin" section="useful">
      <AdminUsefulTasks />
    </AdminAreaShell>
  )
}
