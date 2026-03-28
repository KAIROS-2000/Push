'use client'

import { ParentAccessData } from '@/types'

function submissionStatusLabel(status: string) {
  if (status === 'pending_review') return 'Ожидает проверки'
  if (status === 'checked') return 'Проверено: верно'
  if (status === 'needs_revision') return 'Нужно исправить'
  if (status === 'submitted') return 'Ответ отправлен'
  return status
}

export function ParentDashboard({ data }: { data: ParentAccessData }) {
  return (
    <div className="space-y-6">
      <section className="codequest-card overflow-hidden p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">Родительский кабинет</p>
            <h1 className="mt-2 break-words text-3xl font-black text-slate-900 sm:text-4xl">Прогресс: {data.child.full_name}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              Ученик сейчас на <span className="font-bold text-slate-900">уровне {data.summary.current_level}</span>, у него <span className="font-bold text-slate-900">{data.summary.xp} XP</span> и серия из <span className="font-bold text-slate-900">{data.summary.streak} дней</span>.
            </p>
          </div>
          <div className="w-full rounded-[28px] bg-slate-900 p-5 text-white sm:max-w-sm">
            <p className="text-sm uppercase tracking-[0.2em] text-violet-300">Семейные настройки</p>
            <p className="mt-3 text-sm">Лимит в неделю: {data.invite.weekly_limit_minutes ? `${data.invite.weekly_limit_minutes} мин` : 'не задан'}</p>
            <p className="mt-2 text-sm">Разрешённые модули: {data.invite.modules_whitelist.length ? data.invite.modules_whitelist.join(', ') : 'все'}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['Уроки', String(data.summary.completed_lessons)],
          ['Средний балл', `${data.summary.average_score}%`],
          ['Сдачи', String(data.summary.tasks_submitted)],
        ].map(([label, value]) => (
          <div key={label} className="codequest-card p-5">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">Активность за 7 дней</p>
          <div className="mt-5 grid gap-3">
            {data.weekly_activity.map((day) => {
              const height = Math.max((day.lessons + day.assignments) * 28, 16)
              return (
                <div key={day.date} className="grid gap-3 rounded-[22px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[70px_minmax(0,1fr)_120px] sm:items-center">
                  <p className="text-sm font-semibold text-slate-600">{day.label}</p>
                  <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-3">
                    <div className="flex items-end gap-2">
                      <div className="w-4 rounded-full bg-sky-500" style={{ height }} />
                      <div className="w-4 rounded-full bg-emerald-500" style={{ height: Math.max(day.assignments * 36, 10) }} />
                    </div>
                    <div className="text-sm text-slate-600">
                      <p>Уроки: {day.lessons}</p>
                      <p>Сдачи: {day.assignments}</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-slate-700 sm:text-right">{day.average_score}%</p>
                </div>
              )
            })}
          </div>
        </article>

        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">Модули</p>
          <div className="mt-5 space-y-4">
            {data.modules.map((module) => (
              <div key={module.id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-slate-900">{module.title}</p>
                  <span className="text-sm font-semibold text-slate-600">{module.progress_percent}%</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${module.progress_percent}%`, backgroundColor: module.color }} />
                </div>
                <p className="mt-2 text-sm text-slate-500">Пройдено уроков: {module.completed_lessons}/{module.total_lessons}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">Последние достижения</p>
          <div className="mt-4 space-y-3">
            {data.recent_achievements.map((item) => (
              <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                <p className="font-black text-slate-900">{item.name}</p>
                <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                <p className="mt-2 text-sm font-semibold text-violet-700">+{item.xp_reward} XP</p>
              </div>
            ))}
          </div>
        </article>

        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">Последние сдачи</p>
          <div className="mt-4 space-y-3">
            {data.recent_assignments.map((item) => (
              <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-slate-900">{item.student_username}</p>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700">{item.score}%</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">Статус: {submissionStatusLabel(item.status)}</p>
                {item.feedback && <p className="mt-2 text-sm text-slate-500">Комментарий: {item.feedback}</p>}
              </div>
            ))}
            {data.recent_assignments.length === 0 && <p className="text-sm text-slate-500">Пока нет последних сдач.</p>}
          </div>
        </article>
      </section>
    </div>
  )
}
