import { SiteHeader } from '@/components/site-header'
import { ProfileView } from '@/components/profile-view'

export default function ProfilePage() {
  return (
    <main>
      <SiteHeader />
      <div className="page-shell mx-auto max-w-7xl space-y-6">
        <section className="codequest-card p-6 sm:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-sky-600">Профиль</p>
          <h1 className="page-title mt-2 text-slate-900">Личный кабинет пользователя</h1>
          <p className="page-lead mt-4 max-w-3xl text-slate-600">Управляйте персональными настройками и отслеживайте достижения в едином профиле.</p>
        </section>
        <ProfileView />
      </div>
    </main>
  )
}
