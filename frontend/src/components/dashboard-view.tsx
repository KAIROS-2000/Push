'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { DashboardData } from '@/types'
import { RolePill } from '@/components/role-pill'
import { StatCard } from '@/components/stat-card'

function lessonStateLabel(state?: string | null) {
  if (state === 'completed') return 'Завершён'
  if (state === 'current') return 'В работе'
  if (state === 'open') return 'Доступен'
  if (state === 'locked') return 'Закрыт'
  return null
}

function submissionStatusLabel(status?: string) {
  if (status === 'pending_review') return 'Ожидает проверки'
  if (status === 'checked') return 'Проверено: верно'
  if (status === 'needs_revision') return 'Нужно исправить'
  if (status === 'submitted') return 'Ответ отправлен'
  return 'Ждёт выполнения'
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const [classCode, setClassCode] = useState('')
  const [message, setMessage] = useState('')

  async function loadDashboard() {
    const result = await api<DashboardData>('/dashboard', undefined, true)
    setData(result)
  }

  useEffect(() => {
    loadDashboard().catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить dashboard'))
  }, [])

  async function joinClass() {
    if (!classCode.trim()) {
      setMessage('Введите код класса перед отправкой.')
      return
    }
    try {
      await api('/classes/join', { method: 'POST', body: JSON.stringify({ code: classCode.trim() }) }, true)
      setMessage('Класс успешно подключён.')
      setClassCode('')
      await loadDashboard()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось вступить в класс.')
    }
  }

  async function generateParentInvite() {
    try {
      await api('/parent/invite', { method: 'POST', body: JSON.stringify({ label: 'Семейный кабинет' }) }, true)
      setMessage('Семейная ссылка обновлена.')
      await loadDashboard()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось обновить семейную ссылку.')
    }
  }

  if (error) {
    return <div className="codequest-card p-6 text-rose-700">{error}. Проверьте авторизацию и повторите попытку.</div>
  }

  if (!data) {
    return <div className="codequest-card p-6">Загружаем данные dashboard…</div>
  }

  return (
    <div className="space-y-8">
      {message && <div className="codequest-card break-words bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{message}</div>}

      <section className="codequest-card overflow-hidden p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <RolePill role={data.user.role} />
            <h2 className="mt-3 break-words text-3xl font-black text-slate-900 sm:text-4xl">Привет, {data.user.full_name.split(' ')[0]}!</h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              Ты на уровне <span className="font-bold text-slate-900">{data.user.level}</span>, {data.user.rank_title}. До следующего уровня осталось <span className="font-bold text-slate-900">{data.user.xp_to_next} XP</span>.
            </p>
          </div>
          <div className="codequest-card w-full bg-slate-900 p-5 text-white sm:max-w-sm">
            <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Продолжить</p>
            {data.continue_lesson ? (
              <>
                <h3 className="mt-2 break-words text-2xl font-black">{data.continue_lesson.title}</h3>
                <p className="mt-2 text-sm text-slate-300">{data.continue_lesson.summary}</p>
                <Link href={`/lessons/${data.continue_lesson.id}`} className="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900">
                  Открыть урок
                </Link>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-300">Все доступные уроки пройдены. Выберите новый модуль на roadmap.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard value={String(data.summary.completed_lessons)} label="завершённых уроков" accent="text-sky-600" />
        <StatCard value={String(data.summary.assignments_open)} label="активных заданий" accent="text-emerald-600" />
        <StatCard value={String(data.summary.achievements)} label="достижений" accent="text-violet-600" />
        <StatCard value={String(data.user.streak)} label="дней подряд" accent="text-amber-600" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Daily quests</p>
          <h3 className="mt-2 text-2xl font-black text-slate-900">Ежедневные задачи</h3>
          <div className="mt-5 space-y-3">
            {data.daily_quests.map((quest) => (
              <div key={quest.id} className="flex flex-col items-start gap-3 rounded-[22px] bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-slate-900">{quest.title}</p>
                  <p className="text-sm text-slate-500">Награда: {quest.xp} XP</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${quest.completed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {quest.completed ? 'Готово' : 'В процессе'}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Награды</p>
          <h3 className="mt-2 text-2xl font-black text-slate-900">Последние достижения</h3>
          <div className="mt-5 grid gap-3">
            {data.recent_achievements.length > 0 ? data.recent_achievements.map((item) => (
              <div key={item.id} className="rounded-[22px] bg-white px-4 py-4 shadow-sm">
                <p className="font-bold text-slate-900">{item.name}</p>
                <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                <p className="mt-2 text-sm font-semibold text-sky-600">+{item.xp_reward} XP</p>
              </div>
            )) : <p className="text-sm text-slate-500">Пока нет достижений, начни с первого урока.</p>}
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Мои классы</p>
          <h3 className="mt-2 text-2xl font-black text-slate-900">Учительские группы и домашние задания</h3>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <input className="w-full min-w-0 flex-1 rounded-2xl border border-slate-200 px-4 py-3 sm:min-w-[220px]" value={classCode} onChange={(e) => setClassCode(e.target.value.toUpperCase())} placeholder="Введите код класса" />
            <button onClick={joinClass} className="w-full rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white sm:w-auto">Вступить в класс</button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {data.my_classes.length ? data.my_classes.map((classroom) => (
              <div key={classroom.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <p className="break-words text-lg font-black text-slate-900">{classroom.name}</p>
                <p className="mt-2 text-sm text-slate-600">Код: {classroom.code}</p>
                <p className="mt-1 text-sm text-slate-500">Заданий: {classroom.assignments_count} · Учеников: {classroom.students_count}</p>
              </div>
            )) : <p className="text-sm text-slate-500">Пока нет подключённых классов. Введите код, полученный от вашего учителя.</p>}
          </div>

          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Задания</p>
                <h4 className="mt-2 text-xl font-black text-slate-900">Нажми на задание и перейди в урок</h4>
              </div>
              <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">{data.assignments_preview.length} активных</span>
            </div>

            <div className="mt-5 grid gap-3">
              {data.assignments_preview.length > 0 ? data.assignments_preview.map((assignment) => (
                <div key={assignment.id} className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="break-words text-lg font-black text-slate-900">{assignment.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{assignment.classroom_name}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{assignment.difficulty}</span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-600">{assignment.description}</p>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                    <span className="rounded-full bg-slate-50 px-3 py-1">Срок: {assignment.due_date || 'без срока'}</span>
                    <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">{assignment.assignment_type_label}</span>
                    {assignment.lesson?.title && <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">Урок: {assignment.lesson.title}</span>}
                    {assignment.lesson_state && <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Статус: {lessonStateLabel(assignment.lesson_state)}</span>}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {assignment.lesson_id && assignment.lesson_accessible ? (
                      <Link href={`/lessons/${assignment.lesson_id}`} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                        Открыть урок
                      </Link>
                    ) : assignment.lesson_id ? (
                      <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">Урок пока закрыт</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">Урок не привязан</span>
                    )}

                    {assignment.submission ? (
                      <span className={`rounded-full px-4 py-2 text-sm font-semibold ${
                        assignment.submission.status === 'needs_revision'
                          ? 'bg-amber-100 text-amber-700'
                          : assignment.submission.status === 'checked'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-sky-100 text-sky-700'
                      }`}>{submissionStatusLabel(assignment.submission.status)}</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-700">Ждёт выполнения</span>
                    )}
                  </div>
                </div>
              )) : <p className="text-sm text-slate-500">Пока нет заданий от учителя. Когда они появятся, здесь будет кнопка перехода в урок.</p>}
            </div>
          </div>
        </article>

        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Семья</p>
          <h3 className="mt-2 text-2xl font-black text-slate-900">Родительский кабинет</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">Создайте семейную ссылку, чтобы родители видели прогресс, активности и модули ребёнка.</p>
          <div className="mt-5 rounded-[24px] bg-slate-50 p-5">
            {data.parent_invite ? (
              <>
                <p className="break-words font-bold text-slate-900">Активный код: {data.parent_invite.code}</p>
                <p className="mt-2 break-words text-sm text-slate-500">Открыть кабинет: <Link href={`/parent/${data.parent_invite.code}`} className="break-all font-semibold text-sky-700">/parent/{data.parent_invite.code}</Link></p>
                <p className="mt-2 text-sm text-slate-500">Лимит: {data.parent_invite.weekly_limit_minutes || 'не задан'} мин/нед</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Ещё нет семейной ссылки.</p>
            )}
          </div>
          <button onClick={generateParentInvite} className="mt-4 w-full rounded-full bg-violet-600 px-5 py-3 text-sm font-semibold text-white sm:w-auto">Создать или обновить семейную ссылку</button>
        </article>
      </section>
    </div>
  )
}
