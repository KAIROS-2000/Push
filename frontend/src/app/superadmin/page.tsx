import { AdminWorkspace } from '@/components/admin-workspace'
import { SiteHeader } from '@/components/site-header'

export default function SuperadminPage() {
  return (
    <main>
      <SiteHeader />
      <div className="page-shell mx-auto max-w-7xl space-y-6">
        <section className="codequest-card superadmin-hero p-6 sm:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-rose-600">Суперадмин</p>
          <h1 className="page-title mt-2 text-slate-900">Управление администраторами и платформой</h1>
          <p className="page-lead mt-4 max-w-3xl text-slate-600">Суперадминистратор управляет администраторами платформы: создаёт аккаунты, блокирует, разблокирует и удаляет их при необходимости.</p>
        </section>
        <AdminWorkspace superMode />
      </div>
    </main>
  )
}
