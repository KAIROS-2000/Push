'use client'

import { ParentTeacherChatPanel } from '@/components/parent-teacher-chat-panel'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { api, getApiErrorMessage } from '@/lib/api'
import { useSessionUser } from '@/lib/auth-session'
import { RolePill } from '@/components/role-pill'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { UserItem } from '@/types'

type Child = { id: number; display_name: string; relationship_label?: string | null }

type ParentClassroomContact = {
  thread_id: number | null
  child: { id: number; full_name: string | null }
  teacher: { id: number; full_name: string | null }
  classroom: { id: number; name: string | null }
  updated_at: string | null
  latest_preview: string | null
  unread_count: number
  can_message: boolean
}

type ParentChatOpen = {
  threadId: number
  canMessage: boolean
  title: string
}

function severityRu(s: string) {
  if (s === 'warning') return 'важно'
  if (s === 'attention') return 'внимание'
  return 'инфо'
}

export function ParentCabinetPage() {
  const rootRef = useRef<HTMLElement | null>(null)
  const router = useRouter()
  const { user, status } = useSessionUser({ auth: 'required' })
  const [linkCode, setLinkCode] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [children, setChildren] = useState<Child[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [digest, setDigest] = useState<Record<string, unknown> | null>(null)
  const [skills, setSkills] = useState<unknown[]>([])
  const [activity, setActivity] = useState<Record<string, unknown> | null>(null)
  const [signals, setSignals] = useState<unknown[]>([])
  const [history, setHistory] = useState<unknown[]>([])
  const [safety, setSafety] = useState<Record<string, unknown> | null>(null)
  const [consent, setConsent] = useState<Record<string, unknown> | null>(null)
  const [billing, setBilling] = useState<Record<string, unknown> | null>(null)
  const [notes, setNotes] = useState<unknown[]>([])
  const [classroomContacts, setClassroomContacts] = useState<ParentClassroomContact[]>([])
  const [chatOpen, setChatOpen] = useState<ParentChatOpen | null>(null)
  const [chatStarting, setChatStarting] = useState(false)
  const [achievements, setAchievements] = useState<unknown[]>([])
  const [loadErr, setLoadErr] = useState('')

  useUserPageMotion(rootRef, [selected, children.length])

  useEffect(() => {
    if (status === 'unknown') return
    if (!user) {
      router.replace('/auth/login')
      return
    }
    if (user.role !== 'parent') {
      router.replace('/dashboard')
    }
  }, [user, status, router])

  const loadBase = useCallback(async () => {
    const d = await api<{
      children: Child[]
      selected_child_id: number | null
    }>('/parent/dashboard', undefined, 'required')
    setChildren(d.children || [])
    if (d.selected_child_id) setSelected(d.selected_child_id)
  }, [])

  const loadChild = useCallback(
    async (childId: number) => {
      setLoadErr('')
      try {
        const [di, sk, act, sig, his, sa, co, bi, th, n, ac] = await Promise.all([
          api<Record<string, unknown>>(
            `/parent/children/${childId}/digest`,
            undefined,
            'required',
          ),
          api<{ modules: unknown[] }>(
            `/parent/children/${childId}/skills`,
            undefined,
            'required',
          ),
          api<Record<string, unknown>>(
            `/parent/children/${childId}/activity`,
            undefined,
            'required',
          ),
          api<{ signals: unknown[] }>(
            `/parent/children/${childId}/signals`,
            undefined,
            'required',
          ),
          api<{ items: unknown[] }>(
            `/parent/children/${childId}/practice-history`,
            undefined,
            'required',
          ),
          api<Record<string, unknown>>(
            `/parent/children/${childId}/safety`,
            undefined,
            'required',
          ),
          api<Record<string, unknown>>(
            `/parent/children/${childId}/consent`,
            undefined,
            'required',
          ),
          api<Record<string, unknown>>('/parent/billing', undefined, 'required'),
          api<{
            threads?: Array<Record<string, unknown>>
            classroom_contacts?: ParentClassroomContact[]
          }>('/parent/messaging/threads', undefined, 'required'),
          api<{ notifications: unknown[] }>('/parent/notifications', undefined, 'required'),
          api<{ achievements: unknown[] }>(
            `/parent/children/${childId}/achievements`,
            undefined,
            'required',
          ),
        ])
        setDigest(di)
        setSkills(sk.modules || [])
        setActivity(act)
        setSignals(sig.signals || [])
        setHistory(his.items || [])
        setSafety(sa)
        setConsent(co)
        setBilling(bi)
        const raw = th.classroom_contacts
        if (raw && raw.length) {
          setClassroomContacts(raw)
        } else if (th.threads?.length) {
          setClassroomContacts(
            (
              th.threads as Array<{
                id: number
                child: ParentClassroomContact['child']
                teacher: ParentClassroomContact['teacher']
                classroom: ParentClassroomContact['classroom']
                updated_at?: string | null
                latest_preview?: string | null
                unread_count?: number
              }>
            ).map(t => ({
              thread_id: t.id,
              child: t.child,
              teacher: t.teacher,
              classroom: t.classroom,
              updated_at: t.updated_at ?? null,
              latest_preview: t.latest_preview ?? null,
              unread_count: t.unread_count ?? 0,
              can_message: true,
            })),
          )
        } else {
          setClassroomContacts([])
        }
        setNotes(n.notifications || [])
        setAchievements(ac.achievements || [])
      } catch (e) {
        setLoadErr(getApiErrorMessage(e, 'Не удалось загрузить раздел.'))
      }
    },
    [],
  )

  useEffect(() => {
    if (user?.role !== 'parent') return
    loadBase().catch(e => setLoadErr(getApiErrorMessage(e, 'Ошибка загрузки.')))
  }, [user, loadBase])

  useEffect(() => {
    if (selected) void loadChild(selected)
  }, [selected, loadChild])

  async function onLink() {
    const code = linkCode.trim().toUpperCase().replace(/\s/g, '')
    if (code.length !== 12) {
      showErrorToast('Введите 12-символьный код от ребёнка.')
      return
    }
    setLinkBusy(true)
    try {
      await api('/parent/children/link', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }, 'required')
      showSuccessToast('Связь установлена.')
      setLinkCode('')
      await loadBase()
    } catch (e) {
      showErrorToast(getApiErrorMessage(e, 'Не удалось привязать код.'))
    } finally {
      setLinkBusy(false)
    }
  }

  async function patchSafety(patch: Record<string, unknown>) {
    if (!selected) return
    const r = await api<Record<string, unknown>>(
      `/parent/children/${selected}/safety`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      'required',
    )
    setSafety(r)
  }

  async function patchConsent(patch: Record<string, unknown>) {
    if (!selected) return
    const r = await api<Record<string, unknown>>(
      `/parent/children/${selected}/consent`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      'required',
    )
    setConsent(r)
  }

  function shareAchievement(name: string) {
    const text = `Сегодня ребёнок получил новое достижение на платформе Progyx: ${name}!`
    if (typeof navigator !== 'undefined' && navigator.share) {
      void navigator.share({ text }).catch(() => {
        void navigator.clipboard.writeText(text)
        showSuccessToast('Текст скопирован.')
      })
    } else {
      void navigator.clipboard.writeText(text)
      showSuccessToast('Текст скопирован.')
    }
  }

  const refreshMessaging = useCallback(async () => {
    try {
      const th = await api<{
        classroom_contacts?: ParentClassroomContact[]
        threads?: Array<{
          id: number
          child: ParentClassroomContact['child']
          teacher: ParentClassroomContact['teacher']
          classroom: ParentClassroomContact['classroom']
          updated_at?: string | null
          latest_preview?: string | null
          unread_count?: number
        }>
      }>('/parent/messaging/threads', undefined, 'required')
      const raw = th.classroom_contacts
      if (raw && raw.length) {
        setClassroomContacts(raw)
      } else if (th.threads?.length) {
        setClassroomContacts(
          th.threads.map(t => ({
            thread_id: t.id,
            child: t.child,
            teacher: t.teacher,
            classroom: t.classroom,
            updated_at: t.updated_at ?? null,
            latest_preview: t.latest_preview ?? null,
            unread_count: t.unread_count ?? 0,
            can_message: true,
          })),
        )
      } else {
        setClassroomContacts([])
      }
    } catch {
      // ignore
    }
  }, [])

  const openParentTeacherChat = useCallback(
    async (c: ParentClassroomContact) => {
      const title = `${c.teacher.full_name || 'Педагог'} · ${c.classroom.name || 'Класс'}`
      if (c.thread_id) {
        setChatOpen({ threadId: c.thread_id, canMessage: c.can_message, title })
        return
      }
      setChatStarting(true)
      try {
        const r = await api<{ id: number }>(
          '/parent/messaging/threads',
          {
            method: 'POST',
            body: JSON.stringify({ child_id: c.child.id, classroom_id: c.classroom.id }),
          },
          'required',
        )
        setChatOpen({ threadId: r.id, canMessage: c.can_message, title })
        await refreshMessaging()
      } catch (e) {
        showErrorToast(getApiErrorMessage(e, 'Не удалось открыть чат.'))
      } finally {
        setChatStarting(false)
      }
    },
    [refreshMessaging],
  )

  const contactsForChild = useMemo(
    () => (selected ? classroomContacts.filter(c => c.child.id === selected) : []),
    [selected, classroomContacts],
  )

  if (status === 'unknown' || !user || user.role !== 'parent') {
    return <div className="codequest-card p-6">Загружаем кабинет…</div>
  }

  return (
    <main ref={rootRef} className="brand-app-shell">
      <div className="page-shell mx-auto w-full max-w-[96rem] space-y-6 py-6">
        <header className="codequest-card p-5 sm:p-6" data-motion-reveal>
          <RolePill role={user.role as UserItem['role']} />
          <h1 className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">Семейный кабинет</h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
            Спокойный обзор учёбы: без внутренних метрик среды разработки — только то, что помогает поддержать
            ребёнка.
          </p>
        </header>

        {loadErr ? (
          <div className="codequest-card border border-rose-200 p-4 text-rose-800">{loadErr}</div>
        ) : null}

        <section className="codequest-card p-5 sm:p-6" data-motion-item>
          <p className="brand-eyebrow">Ребята</p>
          {children.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {children.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={`rounded-full border px-4 py-2 text-sm font-bold ${
                    selected === c.id
                      ? 'border-sky-500 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {c.display_name}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Пока нет привязанных детей — добавьте код из кабинета ребёнка.</p>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="text-xs font-bold uppercase text-slate-500">Код от ребёнка (12 символов)</label>
              <input
                className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2 font-mono uppercase"
                value={linkCode}
                onChange={e => setLinkCode(e.target.value)}
                placeholder="например, A1B2C3D4E5F6"
                maxLength={14}
              />
            </div>
            <button
              type="button"
              onClick={onLink}
              disabled={linkBusy}
              className="brand-button-primary shrink-0 disabled:opacity-50"
            >
              {linkBusy ? 'Связываем…' : 'Добавить ребёнка'}
            </button>
          </div>
        </section>

        {selected && (
          <>
            <section className="codequest-card p-5 sm:p-6" data-motion-item>
              <p className="brand-eyebrow">Неделя</p>
              <p className="mt-2 text-sm leading-7 text-slate-800">
                {(digest?.paragraph as string) || 'Загружаем…'}
              </p>
              {typeof digest?.learning_activity_minutes_estimate === 'number' ? (
                <p className="mt-2 text-xs text-slate-500">
                  {(digest?.label as string) || 'Оценка активности:'}{' '}
                  <span className="font-semibold text-slate-700">
                    {digest.learning_activity_minutes_estimate} мин
                  </span>
                </p>
              ) : null}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="codequest-card p-5" data-motion-item>
                <p className="brand-eyebrow">Карта навыков (модули)</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {skills.map(m => {
                    const mod = m as Record<string, unknown>
                    return (
                      <li
                        key={String(mod.id)}
                        className="flex justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2"
                      >
                        <span className="font-medium text-slate-800">{String(mod.title)}</span>
                        <span className="shrink-0 text-xs text-slate-600">
                          {String(mod.state_label || '')}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section className="codequest-card p-5" data-motion-item>
                <p className="brand-eyebrow">Активность</p>
                <p className="mt-2 text-sm text-slate-700">
                  {(activity?.trend_text as string) || 'Считаем тенденции…'}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Серия занятий: {String(typeof activity?.streak === 'number' ? activity?.streak : '—')}
                </p>
              </section>
            </div>

            <section className="codequest-card p-5 sm:p-6" data-motion-item>
              <p className="brand-eyebrow">Сигналы и поддержка</p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {signals.map((s, i) => {
                  const sig = s as Record<string, unknown>
                  return (
                    <li key={i} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
                      <p className="font-bold text-slate-900">{String(sig.title)}</p>
                      <p className="mt-1 text-xs uppercase text-slate-500">{severityRu(String(sig.severity))}</p>
                      <p className="mt-2 text-slate-700">{String(sig.explanation)}</p>
                      <p className="mt-2 text-slate-600">{String(sig.suggested_action)}</p>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="codequest-card p-5" data-motion-item>
              <p className="brand-eyebrow">Практика и задания</p>
              <ul className="mt-3 space-y-2 text-sm">
                {history.map((h, i) => {
                  const it = h as Record<string, unknown>
                  return (
                    <li key={i} className="rounded-2xl border border-slate-100 px-3 py-2">
                      <p className="font-semibold">{String(it.assignment_title || 'Задание')}</p>
                      <p className="text-xs text-slate-500">Статус: {String(it.status)}</p>
                    </li>
                  )
                })}
              </ul>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="codequest-card p-5" data-motion-item>
                <p className="brand-eyebrow">Достижения</p>
                <ul className="mt-3 space-y-2">
                  {achievements.map(a => {
                    const it = a as Record<string, unknown>
                    return (
                      <li
                        key={String(it.id)}
                        className="flex flex-col gap-1 rounded-2xl bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">{String(it.name)}</p>
                          <p className="text-xs text-slate-500">{String(it.description || '')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => shareAchievement(String(it.name))}
                          className="text-sm font-bold text-sky-700"
                        >
                          Поделиться
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section className="codequest-card p-5" data-motion-item>
                <p className="brand-eyebrow">Сообщения с педагогами</p>
                <p className="mt-2 text-sm text-slate-600">
                  Учителя классов, в которых учится выбранный ребёнок. Нажмите «Написать», чтобы открыть чат (если
                  чата ещё не было, он создаётся).
                </p>
                {contactsForChild.length ? (
                  <ul className="mt-3 space-y-2 text-sm">
                    {contactsForChild.map(c => {
                      const key = `${c.classroom.id}-${c.child.id}`
                      return (
                        <li
                          key={key}
                          className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="font-semibold text-slate-900">
                              {c.teacher.full_name || 'Педагог'}{' '}
                              <span className="font-normal text-slate-500">·</span>{' '}
                              {c.classroom.name || 'Класс'}
                            </p>
                            {c.latest_preview ? (
                              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{c.latest_preview}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {c.unread_count > 0 ? (
                              <span className="messaging-unread-badge">{c.unread_count}</span>
                            ) : null}
                            <button
                              type="button"
                              className="brand-button-secondary h-9 px-3 text-xs disabled:opacity-50"
                              disabled={chatStarting || !c.can_message}
                              onClick={() => void openParentTeacherChat(c)}
                              title={!c.can_message ? 'Включите в разделе «Согласия»' : undefined}
                            >
                              {!c.can_message ? 'Связь отключена' : c.thread_id ? 'Открыть' : 'Написать'}
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">
                    Пока нет классов, где состоит этот ребёнок. Пусть введёт код класса в своём кабинете, затем
                    обновите эту страницу.
                  </p>
                )}
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="codequest-card p-5" data-motion-item>
                <p className="brand-eyebrow">Безопасность</p>
                <p className="mt-2 text-sm text-slate-600">Лимиты и публичная видимость (применяются в каталоге и рейтинге).</p>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(safety?.hide_child_public_profile)}
                    onChange={e => void patchSafety({ hide_child_public_profile: e.target.checked })}
                  />
                  Скрыть профиль ребёнка из публичного каталога
                </label>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-bold text-slate-500">
                    Лимит мин/день
                    <input
                      type="number"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1"
                      value={
                        typeof safety?.daily_screen_time_limit_minutes === 'number'
                          ? safety.daily_screen_time_limit_minutes
                          : ''
                      }
                      onChange={e => {
                        const v = e.target.value
                        void patchSafety({
                          daily_screen_time_limit_minutes: v === '' ? null : Number(v),
                        })
                      }}
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-500">
                    Лимит мин/нед
                    <input
                      type="number"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1"
                      value={
                        typeof safety?.weekly_screen_time_limit_minutes === 'number'
                          ? safety.weekly_screen_time_limit_minutes
                          : ''
                      }
                      onChange={e => {
                        const v = e.target.value
                        void patchSafety({
                          weekly_screen_time_limit_minutes: v === '' ? null : Number(v),
                        })
                      }}
                    />
                  </label>
                </div>
              </section>

              <section className="codequest-card p-5" data-motion-item>
                <p className="brand-eyebrow">Согласия</p>
                {[
                  ['allow_notifications', 'Платформенные уведомления о ребёнке'],
                  ['allow_browser_notifications', 'Системные (браузерные) уведомления'],
                  ['allow_achievement_sharing', 'Показ достижений в удобном для семьи виде'],
                  ['allow_learning_analytics_display', 'Показ спокойной аналитики обучения'],
                  ['allow_parent_teacher_communication', 'Связь с педагогом через сообщения'],
                ].map(([key, label]) => (
                  <label key={key} className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={Boolean(consent?.[key as keyof typeof consent])}
                      onChange={e => void patchConsent({ [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </section>
            </div>

            <section className="codequest-card p-5" data-motion-item>
              <p className="brand-eyebrow">Оплата</p>
              <p className="mt-2 text-sm text-slate-700">
                {String(billing?.message || 'Статус оплаты недоступен.')}
              </p>
            </section>

            <section className="codequest-card p-5" data-motion-item>
              <p className="brand-eyebrow">Уведомления</p>
              <ul className="mt-3 space-y-2 text-sm">
                {notes.slice(0, 8).map((n, i) => {
                  const it = n as Record<string, unknown>
                  return (
                    <li key={i} className="rounded-2xl bg-slate-50 px-3 py-2">
                      <p className="font-semibold">{String(it.title)}</p>
                      <p className="text-slate-600">{String(it.body)}</p>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        )}

        <p className="text-center text-xs text-slate-500">
          Нужна помощь? <Link className="font-semibold text-sky-700" href="/parent">На главную</Link>
        </p>
      </div>
      {chatOpen ? (
        <ParentTeacherChatPanel
          threadId={chatOpen.threadId}
          currentUserId={user.id}
          canMessage={chatOpen.canMessage}
          title={chatOpen.title}
          onClose={() => setChatOpen(null)}
          onSent={() => {
            void refreshMessaging()
          }}
        />
      ) : null}
    </main>
  )
}
