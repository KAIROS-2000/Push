import Link from 'next/link'

import { UserLocalTime } from '@/components/user-local-time'
import { formatApiCalendarDayLabelRu } from '@/lib/user-local-time'
import type {
  AdminTelemetryActivityPoint,
  AdminTelemetryData,
  AdminTelemetryDistributionItem,
  AdminTelemetryLessonCompletionItem,
} from '@/types'

const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU')

const ROLE_LABELS: Record<string, string> = {
  student: 'Ученики',
  teacher: 'Учителя',
  admin: 'Админы',
  superadmin: 'Суперадмины',
}

const PROGRESS_LABELS: Record<string, string> = {
  not_started: 'Не начато',
  in_progress: 'В процессе',
  pending_review: 'На проверке',
  needs_revision: 'Доработка',
  completed: 'Завершено',
}

const SUBMISSION_LABELS: Record<string, string> = {
  submitted: 'Сдано',
  pending_review: 'На проверке',
  checked: 'Проверено',
  needs_revision: 'Доработка',
}

const ASSIGNMENT_TYPE_LABELS: Record<string, string> = {
  lesson_practice: 'Практика',
  mini_project: 'Мини-проект',
  quiz: 'Квиз',
  reflection: 'Рефлексия',
}

function formatNumber(value: number | null | undefined) {
  return NUMBER_FORMAT.format(value ?? 0)
}

function formatPercent(value: number | null | undefined) {
  return `${NUMBER_FORMAT.format(value ?? 0)}%`
}

function formatDate(value: string) {
  return formatApiCalendarDayLabelRu(value)
}

function labelFor(value: string, labels: Record<string, string>) {
  return labels[value] ?? value
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function MetricCard({
  label,
  value,
  tone = 'default',
  detail,
}: {
  label: string
  value: string | number
  tone?: 'default' | 'sky' | 'emerald' | 'amber' | 'rose'
  detail?: string
}) {
  const toneClass =
    tone === 'sky'
      ? 'border-sky-200 bg-sky-50/80 text-sky-900'
      : tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50/80 text-amber-900'
          : tone === 'rose'
            ? 'border-rose-200 bg-rose-50/80 text-rose-900'
            : 'border-slate-200 bg-white/80 text-slate-900'

  return (
    <article className={`rounded-[1.75rem] border p-5 shadow-[0_18px_38px_rgba(17,40,93,0.06)] ${toneClass}`}>
      <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black">{value}</p>
      {detail ? <p className="mt-2 text-sm font-semibold text-slate-500">{detail}</p> : null}
    </article>
  )
}

function DistributionBars({
  title,
  eyebrow,
  items,
  labels = {},
}: {
  title: string
  eyebrow: string
  items: AdminTelemetryDistributionItem[]
  labels?: Record<string, string>
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const maxValue = Math.max(1, ...items.map((item) => item.value))

  return (
    <section className="codequest-card p-6 sm:p-7">
      <p className="brand-eyebrow">{eyebrow}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-xl font-black text-slate-900">{title}</h3>
        <span className="brand-chip brand-chip--soft">{formatNumber(total)}</span>
      </div>
      <div className="mt-6 space-y-4">
        {items.length ? (
          items.map((item) => {
            const width = item.value <= 0 ? 0 : Math.max(6, (item.value / maxValue) * 100)
            return (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                  <span className="text-slate-700">{labelFor(item.label, labels)}</span>
                  <span className="text-slate-500">{formatNumber(item.value)}</span>
                </div>
                <div className="h-3 rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${width}%` }}
                    aria-label={`${labelFor(item.label, labels)}: ${formatNumber(item.value)}`}
                  />
                </div>
              </div>
            )
          })
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm font-semibold text-slate-500">
            Нет данных
          </p>
        )}
      </div>
    </section>
  )
}

function ActivityChart({ series }: { series: AdminTelemetryActivityPoint[] }) {
  const maxValue = Math.max(
    1,
    ...series.map((point) => point.registrations + point.lesson_completions + point.practice_submissions),
  )

  return (
    <section className="codequest-card p-6 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="brand-eyebrow">Activity</p>
          <h3 className="mt-3 text-xl font-black text-slate-900">Динамика за 14 дней</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-500">
          <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-700">регистрации</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">уроки</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">практика</span>
        </div>
      </div>
      <div className="mt-6 grid min-h-[15rem] grid-cols-7 items-end gap-2 lg:grid-cols-[repeat(14,minmax(0,1fr))]">
        {series.map((point) => {
          const total = point.registrations + point.lesson_completions + point.practice_submissions
          const height = Math.max(6, (total / maxValue) * 100)
          const registrationsHeight = total ? (point.registrations / total) * 100 : 0
          const lessonsHeight = total ? (point.lesson_completions / total) * 100 : 0
          const submissionsHeight = total ? (point.practice_submissions / total) * 100 : 0

          return (
            <div key={point.date} className="flex h-full min-w-0 flex-col justify-end gap-2">
              <div className="flex h-44 items-end rounded-full bg-slate-100 p-1">
                <div
                  className="flex w-full flex-col justify-end overflow-hidden rounded-full"
                  style={{ height: `${height}%` }}
                  title={`${formatDate(point.date)}: ${formatNumber(total)}`}
                >
                  <div className="bg-sky-500" style={{ height: `${registrationsHeight}%` }} />
                  <div className="bg-emerald-500" style={{ height: `${lessonsHeight}%` }} />
                  <div className="bg-amber-400" style={{ height: `${submissionsHeight}%` }} />
                </div>
              </div>
              <span className="truncate text-center text-[0.65rem] font-bold text-slate-500">
                {formatDate(point.date)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function LowestCompletionTable({ lessons }: { lessons: AdminTelemetryLessonCompletionItem[] }) {
  return (
    <section className="codequest-card p-6 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="brand-eyebrow">Lessons</p>
          <h3 className="mt-3 text-xl font-black text-slate-900">Уроки с низким прохождением</h3>
        </div>
        <span className="brand-chip brand-chip--warm">по стартовавшим ученикам</span>
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs font-bold uppercase text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-3 py-3">Урок</th>
              <th className="whitespace-nowrap px-3 py-3">Модуль</th>
              <th className="whitespace-nowrap px-3 py-3">Прохождение</th>
              <th className="whitespace-nowrap px-3 py-3">Завершили</th>
              <th className="whitespace-nowrap px-3 py-3">Средний балл</th>
              <th className="whitespace-nowrap px-3 py-3">Попытки</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lessons.length ? (
              lessons.map((lesson) => (
                <tr key={lesson.lesson_id} className="align-top">
                  <td className="max-w-[18rem] px-3 py-4 font-bold text-slate-900">
                    <Link className="hover:text-sky-700" href={`/lessons/${lesson.lesson_id}`}>
                      {lesson.title}
                    </Link>
                  </td>
                  <td className="px-3 py-4 text-slate-500">{lesson.module_title}</td>
                  <td className="px-3 py-4">
                    <div className="min-w-[9rem] space-y-2">
                      <div className="flex items-center justify-between gap-2 font-bold text-slate-700">
                        <span>{formatPercent(lesson.completion_rate)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-rose-500"
                          style={{
                            width: `${lesson.completion_rate <= 0 ? 0 : Math.max(4, clampPercent(lesson.completion_rate))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-slate-600">
                    {formatNumber(lesson.completed_count)} / {formatNumber(lesson.started_count)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-slate-600">
                    {formatPercent(lesson.average_score)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-slate-600">
                    {formatNumber(lesson.attempts)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-8 text-center font-semibold text-slate-500" colSpan={6}>
                  Пока нет уроков со стартовавшим прогрессом.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function AdminTelemetryPanel({ telemetry }: { telemetry: AdminTelemetryData | null }) {
  if (!telemetry) {
    return (
      <section className="codequest-card p-6 sm:p-7">
        <p className="brand-eyebrow">Telemetry</p>
        <h2 className="mt-3 text-2xl font-black text-slate-900">Телеметрия временно недоступна</h2>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          Сервер не вернул аналитические метрики. Попробуйте обновить страницу после проверки API.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <section className="codequest-card p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl space-y-3">
            <p className="brand-eyebrow">Telemetry</p>
            <h1 className="text-3xl font-black text-slate-900">Аналитика платформы</h1>
            <p className="text-sm leading-7 text-slate-500">
              Нагрузка, аудитория, прохождение уроков и сдачи практических заданий в одном экране.
            </p>
          </div>
          <span className="brand-chip brand-chip--soft">
            Обновлено{' '}
            {telemetry.generated_at ? (
              <UserLocalTime iso={telemetry.generated_at} variant="admin" emptyLabel="Нет данных" />
            ) : (
              'Нет данных'
            )}
          </span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="На сайте"
          value={formatNumber(telemetry.load.active_users)}
          detail={`${formatNumber(telemetry.load.active_sessions)} активных сессий`}
          tone="sky"
        />
        <MetricCard
          label="Ученики / учителя"
          value={`${formatNumber(telemetry.load.active_students)} / ${formatNumber(telemetry.load.active_teachers)}`}
          detail="по активным сессиям"
          tone="emerald"
        />
        <MetricCard
          label="Сдачи за 24ч"
          value={formatNumber(telemetry.load.practice_submissions_24h)}
          detail={`${formatNumber(telemetry.load.pending_reviews)} ждут проверки`}
          tone="amber"
        />
        <MetricCard
          label="Уроки за 24ч"
          value={formatNumber(telemetry.load.lesson_completions_24h)}
          detail={`${formatNumber(telemetry.load.logins_24h)} входов за сутки`}
          tone="default"
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Всего пользователей" value={formatNumber(telemetry.audience.total_users)} />
        <MetricCard label="Ученики" value={formatNumber(telemetry.audience.students)} />
        <MetricCard label="Учителя" value={formatNumber(telemetry.audience.teachers)} />
        <MetricCard
          label="Риски очередей"
          value={formatNumber(
            telemetry.load.pending_reviews +
              telemetry.load.pending_teacher_requests +
              telemetry.load.pending_class_join_requests,
          )}
          detail="проверки, заявки, вступления"
          tone="rose"
        />
      </section>

      <ActivityChart series={telemetry.activity.series} />

      <section className="grid gap-4 xl:grid-cols-2">
        <DistributionBars
          eyebrow="Audience"
          title="Роли пользователей"
          items={telemetry.audience.role_distribution}
          labels={ROLE_LABELS}
        />
        <DistributionBars
          eyebrow="Sessions"
          title="Активные сессии по ролям"
          items={telemetry.audience.active_session_distribution}
          labels={ROLE_LABELS}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <MetricCard
          label="Прохождение"
          value={formatPercent(telemetry.learning.completion_rate)}
          detail={`${formatNumber(telemetry.learning.completed_lessons)} завершений`}
          tone="emerald"
        />
        <MetricCard
          label="Средний балл уроков"
          value={formatPercent(telemetry.learning.average_score)}
          detail={`${formatNumber(telemetry.learning.total_attempts)} попыток`}
          tone="sky"
        />
        <MetricCard
          label="Практика"
          value={formatNumber(telemetry.practice.submissions)}
          detail={`${formatPercent(telemetry.practice.submission_rate)} заданий со сдачами`}
          tone="amber"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <DistributionBars
          eyebrow="Progress"
          title="Статусы уроков"
          items={telemetry.learning.status_distribution}
          labels={PROGRESS_LABELS}
        />
        <DistributionBars
          eyebrow="Submissions"
          title="Статусы практики"
          items={telemetry.practice.status_distribution}
          labels={SUBMISSION_LABELS}
        />
        <DistributionBars
          eyebrow="Assignments"
          title="Типы заданий"
          items={telemetry.practice.assignment_type_distribution}
          labels={ASSIGNMENT_TYPE_LABELS}
        />
      </section>

      <LowestCompletionTable lessons={telemetry.learning.lowest_completion_lessons} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Модули / уроки"
          value={`${formatNumber(telemetry.content.modules)} / ${formatNumber(telemetry.content.lessons)}`}
          detail={`${formatNumber(telemetry.content.published_lessons)} опубликовано`}
        />
        <MetricCard label="Кастомные уроки" value={formatNumber(telemetry.content.custom_lessons)} />
        <MetricCard label="Классы" value={formatNumber(telemetry.content.classrooms)} />
        <MetricCard label="Задания" value={formatNumber(telemetry.content.assignments)} />
      </section>
    </div>
  )
}
