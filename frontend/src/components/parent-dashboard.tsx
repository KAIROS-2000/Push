'use client'

import { useRef } from 'react'

import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { ParentAccessData } from '@/types'

function submissionStatusLabel(status: string) {
  if (status === 'pending_review') return 'Ожидает проверки'
  if (status === 'checked') return 'Проверено: верно'
  if (status === 'needs_revision') return 'Нужно исправить'
  if (status === 'submitted') return 'Ответ отправлен'
  return status
}

export function ParentDashboard({ data }: { data: ParentAccessData }) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useUserPageMotion(rootRef, [data.child.full_name, data.modules.length, data.recent_assignments.length])

  return (
    <div ref={rootRef} className="space-y-6">
      <section className="parent-summary codequest-card overflow-hidden p-5 sm:p-8" data-motion-reveal>
        <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div data-motion-hero-copy>
            <p className="brand-eyebrow">Как идут дела</p>
            <h1 className="mt-3 break-words text-4xl font-black leading-tight text-slate-900 sm:text-5xl">
              {data.child.full_name}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
              Сейчас ребёнок на <span className="font-bold text-slate-900">уровне {data.summary.current_level}</span>, уже набрал{' '}
              <span className="font-bold text-slate-900">{data.summary.xp} XP</span> и держит серию из{' '}
              <span className="font-bold text-slate-900">{data.summary.streak} дней</span>.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="brand-chip brand-chip--soft">уроки: {data.summary.completed_lessons}</span>
              <span className="brand-chip brand-chip--soft">сдачи: {data.summary.tasks_submitted}</span>
              <span className="brand-chip brand-chip--warm">средний балл: {data.summary.average_score}%</span>
            </div>
          </div>

          <div className="dashboard-next w-full p-5 sm:p-6" data-motion-hero-visual>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-100">Семейные настройки</p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-sky-50/90">
              <p>
                Лимит в неделю:{' '}
                <span className="font-semibold text-white">
                  {data.invite.weekly_limit_minutes ? `${data.invite.weekly_limit_minutes} мин` : 'не задан'}
                </span>
              </p>
              <p>
                Разрешённые модули:{' '}
                <span className="break-words font-semibold text-white">
                  {data.invite.modules_whitelist.length ? data.invite.modules_whitelist.join(', ') : 'все'}
                </span>
              </p>
            </div>
            <div className="mt-5 rounded-[24px] bg-white/12 p-4 text-sm leading-7 text-sky-50/90">
              Кабинет построен так, чтобы вы быстро понимали главное: насколько ребёнок движется вперёд, в каком темпе работает и где ему может понадобиться поддержка.
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3" data-motion-stagger>
        {[
          ['Уроки', String(data.summary.completed_lessons)],
          ['Средний балл', `${data.summary.average_score}%`],
          ['Сдачи', String(data.summary.tasks_submitted)],
        ].map(([label, value]) => (
          <div key={label} className="brand-stat-card codequest-card p-5" data-kicker="family metric" data-motion-item data-motion-hover>
            <p className="text-4xl font-black leading-none text-slate-900 sm:text-5xl">{value}</p>
            <p className="mt-3 text-sm text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.95fr]" data-motion-stagger>
        <article className="codequest-card p-6" data-motion-item>
          <p className="brand-eyebrow">Активность за 7 дней</p>
          <div className="mt-5 grid gap-3">
            {data.weekly_activity.map((day) => {
              const lessonsHeight = Math.max(day.lessons * 28, 16)
              const assignmentsHeight = Math.max(day.assignments * 36, 10)
              return (
                <div
                  key={day.date}
                  className="grid gap-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[70px_minmax(0,1fr)_120px] sm:items-center"
                >
                  <p className="text-sm font-semibold text-slate-600">{day.label}</p>
                  <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-3">
                    <div className="flex items-end gap-2">
                      <div className="w-4 rounded-full bg-sky-500" style={{ height: lessonsHeight }} />
                      <div className="w-4 rounded-full bg-emerald-500" style={{ height: assignmentsHeight }} />
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

        <article className="codequest-card p-6" data-motion-item>
          <p className="brand-eyebrow">Модули</p>
          <h2 className="mt-3 text-2xl font-black text-slate-900">По каким темам ребёнок движется сейчас</h2>
          <div className="mt-5 space-y-4">
            {data.modules.map((module) => (
              <div key={module.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="break-words font-black text-slate-900">{module.title}</p>
                  <span className="text-sm font-semibold text-slate-600">{module.progress_percent}%</span>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${module.progress_percent}%`, backgroundColor: module.color }}
                  />
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  Пройдено уроков: {module.completed_lessons}/{module.total_lessons}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-2" data-motion-stagger>
        <article className="codequest-card p-6" data-motion-item>
          <p className="brand-eyebrow">Достижения</p>
          <div className="mt-4 space-y-3">
            {data.recent_achievements.map((item) => (
              <div key={item.id} className="rounded-[24px] bg-slate-50 p-4">
                <p className="font-black text-slate-900">{item.name}</p>
                <p className="mt-1 text-sm leading-7 text-slate-600">{item.description}</p>
                <p className="mt-3 text-sm font-semibold text-violet-700">+{item.xp_reward} XP</p>
              </div>
            ))}
          </div>
        </article>

        <article className="codequest-card p-6" data-motion-item>
          <p className="brand-eyebrow">Последние сдачи</p>
          <div className="mt-4 space-y-3">
            {data.recent_assignments.map((item) => (
              <div key={item.id} className="rounded-[24px] bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="break-words font-black text-slate-900">{item.assignment_title || 'Последняя сдача'}</p>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700">{item.score}%</span>
                </div>
                <p className="mt-3 text-sm text-slate-600">Статус: {submissionStatusLabel(item.status)}</p>
                {item.feedback && <p className="mt-2 text-sm leading-7 text-slate-500">Комментарий: {item.feedback}</p>}
              </div>
            ))}
            {data.recent_assignments.length === 0 && (
              <p className="text-sm text-slate-500">Пока нет последних сдач.</p>
            )}
          </div>
        </article>
      </section>
    </div>
  )
}
