import { AdminAreaShell } from '@/components/admin-area-shell'
import { AdminTelemetryPanel } from '@/components/admin-telemetry-panel'
import { serverApi } from '@/lib/server-api'
import type { AdminTelemetryData } from '@/types'

export default async function AdminTelemetryPage() {
  const telemetry = await serverApi<AdminTelemetryData>('/admin/telemetry').catch(() => null)

  return (
    <AdminAreaShell area="admin" section="telemetry">
      <AdminTelemetryPanel telemetry={telemetry} />
    </AdminAreaShell>
  )
}
