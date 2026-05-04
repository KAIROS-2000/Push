import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminAssignmentImages } from '@/components/admin-assignment-images'

export default function AdminMediaPage() {
  return (
    <AdminAreaShell area="admin" section="media">
      <AdminAssignmentImages />
    </AdminAreaShell>
  )
}
