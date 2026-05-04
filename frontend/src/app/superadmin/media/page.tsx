import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminAssignmentImages } from '@/components/admin-assignment-images'

export default function SuperadminMediaPage() {
  return (
    <AdminAreaShell area="superadmin" section="media">
      <AdminAssignmentImages />
    </AdminAreaShell>
  )
}
