import { SiteHeader } from '@/components/site-header'
import { TeacherWorkspace } from '@/components/teacher-workspace'

export default function TeacherPage() {
  return (
    <main>
      <SiteHeader />
      <div className="page-shell mx-auto max-w-7xl space-y-6">
        <section className="codequest-card p-6 sm:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-600">Кабинет учителя</p>
          <h1 className="mt-2 text-3xl font-black text-slate-900 md:text-4xl">Классы, уроки и проверка работ</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 md:text-lg">Создавайте классы, собирайте уроки и проверяйте ответы учеников в одном месте.</p>
        </section>
        <TeacherWorkspace />
      </div>
    </main>
  )
}
