'use client'

import { ParentTeacherChatPanel } from '@/components/parent-teacher-chat-panel'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { api, getApiErrorMessage, resendVerification } from '@/lib/api'
import { useSessionUser } from '@/lib/auth-session'
import { RolePill } from '@/components/role-pill'
import {
  Award,
  BarChart3,
  BookOpenCheck,
  ClipboardList,
  Flame,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
  DEFAULT_PARENT_VIEW_MODE,
  PARENT_VIEW_MODE_CHANGE_EVENT,
  type ParentViewMode,
  getStoredParentViewMode,
  persistParentViewMode,
} from '@/lib/parent-view-mode'
import type { UsefulTaskItem, UsefulTaskListResponse, UserItem } from '@/types'

type Child = {
  id: number
  display_name: string
  relationship_label?: string | null
  age_group?: string | null
}

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

type ActivityRow = {
  date: string
  label: string
  lessons: number
  assignments: number
  average_score: number
}

type SkillModule = {
  id: string
  title: string
  color: string
  completed_lessons: number
  total_lessons: number
  progress_percent: number
  skill_state: string
  state_label: string
}

type PracticeItem = {
  id: string
  assignment_title: string
  assignment_image_url: string | null
  score: number
  status: string
  feedback: string
  submitted_at: string
}

type MetricTone = 'blue' | 'green' | 'yellow' | 'rose' | 'violet'

function severityRu(s: string) {
  if (s === 'warning') return 'важно'
  if (s === 'attention') return 'внимание'
  return 'инфо'
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toStringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function average(values: number[]) {
  const clean = values.filter(value => Number.isFinite(value))
  if (!clean.length) return 0
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length)
}

function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties
}

function safeCssColor(value: unknown, fallback = '#0b67ff') {
  const color = toStringValue(value).trim()
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback
}

function normalizeActivityRows(value: unknown): ActivityRow[] {
  if (!Array.isArray(value)) return []
  return value.slice(-7).map((item, index) => {
    const row = toRecord(item)
    return {
      date: toStringValue(row.date, ''),
      label: toStringValue(row.label, `День ${index + 1}`),
      lessons: toNumber(row.lessons),
      assignments: toNumber(row.assignments),
      average_score: toNumber(row.average_score),
    }
  })
}

function normalizeSkillModules(value: unknown[]): SkillModule[] {
  return value.map((item, index) => {
    const row = toRecord(item)
    return {
      id: String(row.id ?? index),
      title: toStringValue(row.title, 'Модуль'),
      color: safeCssColor(row.color),
      completed_lessons: toNumber(row.completed_lessons),
      total_lessons: toNumber(row.total_lessons),
      progress_percent: clampPercent(toNumber(row.progress_percent)),
      skill_state: toStringValue(row.skill_state, 'not_started'),
      state_label: toStringValue(row.state_label, 'Впереди'),
    }
  })
}

function normalizePracticeItems(value: unknown[]): PracticeItem[] {
  return value.map((item, index) => {
    const row = toRecord(item)
    const rawImage = row.assignment_image_url
    return {
      id: String(row.id ?? index),
      assignment_title: toStringValue(row.assignment_title, 'Задание'),
      assignment_image_url: typeof rawImage === 'string' && rawImage ? rawImage : null,
      score: clampPercent(toNumber(row.score)),
      status: toStringValue(row.status, 'submitted'),
      feedback: toStringValue(row.feedback, ''),
      submitted_at: toStringValue(row.submitted_at, ''),
    }
  })
}

function practiceStatusRu(status: string) {
  if (status === 'pending_review') return 'Ожидает проверки'
  if (status === 'checked') return 'Проверено'
  // Parent cabinet copy is positive-leaning (P3a): avoid "must fix" framing.
  if (status === 'needs_revision') return 'На доработке'
  if (status === 'submitted') return 'Отправлено'
  return 'В работе'
}

function practiceStatusTone(status: string) {
  if (status === 'checked') return 'success'
  if (status === 'needs_revision') return 'warning'
  if (status === 'pending_review') return 'info'
  return 'muted'
}

function formatPracticeDate(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

function trendText(current: number, previous: number) {
  if (!previous && current > 0) return 'появилась активность'
  if (!previous && !current) return 'ждём первых действий'
  const delta = Math.round(((current - previous) / Math.max(previous, 1)) * 100)
  if (delta > 0) return `+${delta}% к прошлой неделе`
  if (delta < 0) return `${delta}% к прошлой неделе`
  return 'на уровне прошлой недели'
}

function ParentMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  tone: MetricTone
}) {
  return (
    <article
      className={`parent-metric-card parent-metric-card--${tone} codequest-card`}
      data-motion-item
      data-motion-hover
    >
      <span className="parent-metric-card__icon" aria-hidden="true">
        <Icon size={20} strokeWidth={2.3} />
      </span>
      <div className="min-w-0">
        <p className="parent-metric-card__label">{label}</p>
        <p className="parent-metric-card__value">{value}</p>
        <p className="parent-metric-card__detail">{detail}</p>
      </div>
    </article>
  )
}

function WeekActivityChart({
  rows,
  previousRows,
}: {
  rows: ActivityRow[]
  previousRows: ActivityRow[]
}) {
  const maxTotal = Math.max(
    1,
    ...rows.map(row => row.lessons + row.assignments),
    ...previousRows.map(row => row.lessons + row.assignments),
  )

  if (!rows.length) {
    return (
      <div className="parent-empty-state">
        Данные недели пока не собраны. Они появятся после уроков и практики.
      </div>
    )
  }

  return (
    <div className="parent-week-chart" aria-label="Активность по дням недели">
      {rows.map((row, index) => {
        const total = row.lessons + row.assignments
        const previousTotal = (previousRows[index]?.lessons || 0) + (previousRows[index]?.assignments || 0)
        const currentPercent = clampPercent((total / maxTotal) * 100)
        const previousPercent = clampPercent((previousTotal / maxTotal) * 100)
        const lessonShare = total ? clampPercent((row.lessons / total) * 100) : 0
        const assignmentShare = total ? 100 - lessonShare : 0

        return (
          <div className="parent-week-chart__row" key={`${row.date}-${row.label}`}>
            <span className="parent-week-chart__label">{row.label}</span>
            <div
              className="parent-week-chart__track"
              style={cssVars({
                '--current': `${currentPercent}%`,
                '--previous': `${previousPercent}%`,
                '--lesson-share': `${lessonShare}%`,
                '--assignment-share': `${assignmentShare}%`,
              })}
              title={`${row.lessons} уроков, ${row.assignments} практик`}
            >
              <span className="parent-week-chart__previous" />
              <span className="parent-week-chart__current">
                <span className="parent-week-chart__lessons" />
                <span className="parent-week-chart__assignments" />
              </span>
            </div>
            <span className="parent-week-chart__count">{total}</span>
          </div>
        )
      })}
    </div>
  )
}

function SkillProgressPanel({
  modules,
  overallProgress,
}: {
  modules: SkillModule[]
  overallProgress: number
}) {
  const mastered = modules.filter(module => module.skill_state === 'mastered').length
  const inProgress = modules.filter(module => module.skill_state === 'in_progress').length
  const needsHelp = modules.filter(module => module.skill_state === 'needs_help').length
  const notStarted = Math.max(0, modules.length - mastered - inProgress - needsHelp)

  return (
    <div className="parent-skill-layout">
      <div className="parent-progress-ring-card">
        <div
          className="parent-progress-ring"
          style={cssVars({ '--value': `${overallProgress}%` })}
          role="img"
          aria-label={`Средний прогресс по модулям ${overallProgress}%`}
        >
          <span>{overallProgress}%</span>
        </div>
        <p className="mt-3 text-sm font-bold text-slate-900">Средний прогресс по модулям</p>
        <div className="mt-3 grid gap-2 text-xs text-slate-600">
          <span><b>{mastered}</b> уверенно получается</span>
          <span><b>{inProgress}</b> сейчас тренируется</span>
          <span><b>{needsHelp}</b> требует поддержки</span>
          <span><b>{notStarted}</b> ещё впереди</span>
        </div>
      </div>

      <div className="parent-module-list">
        {modules.length ? (
          modules.map(module => (
            <article
              className={`parent-module-row parent-module-row--${module.skill_state}`}
              key={module.id}
              style={cssVars({
                '--module-progress': `${module.progress_percent}%`,
                '--module-color': module.color,
              })}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{module.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {module.completed_lessons}/{module.total_lessons || '—'} уроков · {module.state_label}
                  </p>
                </div>
                <span className="parent-module-row__percent">{module.progress_percent}%</span>
              </div>
              <div className="parent-module-row__track" aria-hidden="true">
                <span />
              </div>
            </article>
          ))
        ) : (
          <div className="parent-empty-state">
            Карта модулей появится после публикации уроков для возрастной группы ребёнка.
          </div>
        )}
      </div>
    </div>
  )
}

function PracticeScoreChart({ items }: { items: PracticeItem[] }) {
  const chartItems = items.slice(0, 8).reverse()

  if (!chartItems.length) {
    return (
      <div className="parent-empty-state">
        Практика пока пустая. Когда ребёнок отправит задания, здесь появятся баллы и статусы.
      </div>
    )
  }

  return (
    <div className="parent-score-chart" aria-label="Последние баллы за практику">
      {chartItems.map(item => (
        <div className="parent-score-chart__item" key={item.id}>
          <div
            className={`parent-score-chart__bar parent-score-chart__bar--${practiceStatusTone(item.status)}`}
            style={cssVars({ '--score': `${item.score}%` })}
            title={`${item.assignment_title}: ${item.score}%`}
          >
            <span />
          </div>
          <span className="parent-score-chart__label">{formatPracticeDate(item.submitted_at)}</span>
        </div>
      ))}
    </div>
  )
}

export function ParentCabinetPage() {
  const rootRef = useRef<HTMLElement | null>(null)
  const router = useRouter()
  const { user, status } = useSessionUser({ auth: 'required' })
  const [linkCode, setLinkCode] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [children, setChildren] = useState<Child[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  // Parent profile gate: backend refuses /parent/children/link until the
  // parent has full_name + phone AND a verified email. We mirror that here
  // so the UI can show a focused "complete your profile" card BEFORE the
  // user tries to attach a child and gets a 400.
  const [profileStatus, setProfileStatus] = useState<{
    ready_to_link_child: boolean
    missing_fields: string[]
    user: { full_name: string; phone: string; email: string; email_verified: boolean }
  } | null>(null)
  const [profileForm, setProfileForm] = useState({ full_name: '', phone: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileResending, setProfileResending] = useState(false)
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
  const [usefulTasks, setUsefulTasks] = useState<UsefulTaskItem[]>([])
  const [loadErr, setLoadErr] = useState('')
  // P3b: simple (default) shows only successes & achievements; extended unlocks all blocks.
  // SSR-safe: render with the default first, then hydrate from localStorage on mount.
  const [viewMode, setViewMode] = useState<ParentViewMode>(DEFAULT_PARENT_VIEW_MODE)

  useUserPageMotion(rootRef, [selected, children.length, viewMode])

  useEffect(() => {
    const stored = getStoredParentViewMode()
    if (stored) setViewMode(stored)
    function onExternalChange(event: Event) {
      const next = (event as CustomEvent<ParentViewMode>).detail
      if (next === 'simple' || next === 'extended') setViewMode(next)
    }
    function onStorageChange(event: StorageEvent) {
      // Cross-tab sync.
      if (event.key !== 'codequest_parent_view_mode' || !event.newValue) return
      if (event.newValue === 'simple' || event.newValue === 'extended') {
        setViewMode(event.newValue)
      }
    }
    window.addEventListener(PARENT_VIEW_MODE_CHANGE_EVENT, onExternalChange as EventListener)
    window.addEventListener('storage', onStorageChange)
    return () => {
      window.removeEventListener(PARENT_VIEW_MODE_CHANGE_EVENT, onExternalChange as EventListener)
      window.removeEventListener('storage', onStorageChange)
    }
  }, [])

  const switchViewMode = useCallback((next: ParentViewMode) => {
    setViewMode(next)
    persistParentViewMode(next)
  }, [])

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

  const loadProfileStatus = useCallback(async () => {
    try {
      const status = await api<{
        ready_to_link_child: boolean
        missing_fields: string[]
        required_fields: string[]
        user: { full_name: string; phone: string; email: string; email_verified: boolean }
      }>('/parent/profile/status', undefined, 'required')
      setProfileStatus({
        ready_to_link_child: status.ready_to_link_child,
        missing_fields: status.missing_fields || [],
        user: status.user,
      })
      setProfileForm((prev) => ({
        full_name: prev.full_name || status.user.full_name || '',
        phone: prev.phone || status.user.phone || '',
      }))
    } catch {
      // Non-fatal: profile gate will simply not render the prompt.
    }
  }, [])

  const loadBase = useCallback(async () => {
    const d = await api<{
      children: Child[]
      selected_child_id: number | null
    }>('/parent/dashboard', undefined, 'required')
    setChildren(d.children || [])
    if (d.selected_child_id) setSelected(d.selected_child_id)
    await loadProfileStatus()
  }, [loadProfileStatus])

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

  // Useful tasks (P2 widget): fetch top items filtered by the child's age_group.
  // Lives outside loadChild because it is independent of submission/digest data.
  useEffect(() => {
    if (!selected) {
      setUsefulTasks([])
      return
    }
    const child = children.find(c => c.id === selected)
    const ageGroup = child?.age_group && child.age_group !== 'adult' ? child.age_group : null
    const params = new URLSearchParams()
    if (ageGroup) params.set('age_group', ageGroup)
    params.set('limit', '4')
    api<UsefulTaskListResponse>(
      `/useful${params.toString() ? `?${params.toString()}` : ''}`,
      undefined,
      'required',
    )
      .then(data => setUsefulTasks(data.tasks || []))
      .catch(() => setUsefulTasks([]))
  }, [selected, children])

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
      // Refresh the profile gate so a 400/parent_profile_incomplete can
      // surface the correct hint without the user having to refresh.
      void loadProfileStatus()
    } finally {
      setLinkBusy(false)
    }
  }

  async function onSaveProfile() {
    const fullName = profileForm.full_name.trim()
    const phoneInput = profileForm.phone.trim()
    if (!fullName) {
      showErrorToast('Укажите имя.')
      return
    }
    if (!phoneInput) {
      showErrorToast('Укажите номер телефона.')
      return
    }
    setProfileSaving(true)
    try {
      await api('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ full_name: fullName, phone: phoneInput }),
      }, 'required')
      showSuccessToast('Профиль обновлён.')
      await loadProfileStatus()
    } catch (e) {
      showErrorToast(getApiErrorMessage(e, 'Не удалось сохранить профиль.'))
    } finally {
      setProfileSaving(false)
    }
  }

  async function onResendVerification() {
    setProfileResending(true)
    try {
      await resendVerification()
      showSuccessToast('Письмо отправлено повторно. Проверьте почту.')
    } catch (e) {
      showErrorToast(getApiErrorMessage(e, 'Не удалось отправить письмо повторно.'))
    } finally {
      setProfileResending(false)
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
  const selectedChild = useMemo(
    () => children.find(child => child.id === selected) ?? null,
    [children, selected],
  )
  const weeklyActivity = useMemo(
    () => normalizeActivityRows(activity?.this_week),
    [activity],
  )
  const previousWeekActivity = useMemo(
    () => normalizeActivityRows(activity?.previous_week),
    [activity],
  )
  const skillModules = useMemo(() => normalizeSkillModules(skills), [skills])
  const practiceItems = useMemo(() => normalizePracticeItems(history), [history])
  const signalItems = useMemo(() => signals.map(toRecord), [signals])
  const achievementItems = useMemo(() => achievements.map(toRecord), [achievements])
  const noteItems = useMemo(() => notes.map(toRecord), [notes])

  const weeklyLessons = weeklyActivity.reduce((sum, row) => sum + row.lessons, 0)
  const weeklyAssignments = weeklyActivity.reduce((sum, row) => sum + row.assignments, 0)
  const weeklyActions = weeklyLessons + weeklyAssignments
  const previousActions = previousWeekActivity.reduce(
    (sum, row) => sum + row.lessons + row.assignments,
    0,
  )
  const weeklyAverageScore = average(
    weeklyActivity.map(row => row.average_score).filter(score => score > 0),
  )
  const practiceAverageScore = average(practiceItems.map(item => item.score))
  const visibleAverageScore = weeklyAverageScore || practiceAverageScore
  const activityMinutes = toNumber(
    activity?.activity_minutes_estimate ?? digest?.learning_activity_minutes_estimate,
  )
  const streakDays = toNumber(activity?.streak)
  const overallProgress = average(skillModules.map(module => module.progress_percent))
  const masteredModules = skillModules.filter(module => module.skill_state === 'mastered').length
  const needsHelpModules = skillModules.filter(module => module.skill_state === 'needs_help')
  const pendingPractice = practiceItems.filter(item =>
    ['pending_review', 'needs_revision', 'submitted'].includes(item.status),
  )
  const importantSignals = signalItems.filter(signal => String(signal.severity || 'info') !== 'info')
  const unreadMessages = contactsForChild.reduce((sum, contact) => sum + contact.unread_count, 0)
  const focusModule =
    needsHelpModules[0] ||
    skillModules.find(module => module.skill_state === 'in_progress') ||
    skillModules.find(module => module.progress_percent > 0 && module.progress_percent < 100) ||
    null
  const nextFocus = needsHelpModules[0]
    ? `Поддержать модуль «${needsHelpModules[0].title}»`
    : pendingPractice[0]
      ? `Посмотреть задание «${pendingPractice[0].assignment_title}»`
      : importantSignals[0]
        ? String(importantSignals[0].title || 'Проверить сигнал')
        : focusModule
          ? `Продолжить модуль «${focusModule.title}»`
          : 'Сохранять спокойный темп занятий'

  const allParentMetrics = [
    {
      icon: TrendingUp,
      label: 'Темп недели',
      value: String(weeklyActions),
      detail: `${weeklyLessons} уроков · ${weeklyAssignments} практик · ${trendText(weeklyActions, previousActions)}`,
      tone: 'blue' as const,
      simple: true,
    },
    {
      icon: Flame,
      label: 'Серия занятий',
      value: streakDays ? `${streakDays} дн.` : '—',
      detail: streakDays >= 7 ? 'ритм уже устойчивый' : 'мягко поддерживайте регулярность',
      tone: 'yellow' as const,
      simple: true,
    },
    {
      icon: BarChart3,
      label: 'Средний балл',
      value: visibleAverageScore ? `${visibleAverageScore}%` : '—',
      detail: visibleAverageScore >= 80 ? 'решения уверенные' : 'есть зоны для роста',
      tone: visibleAverageScore >= 80 ? 'green' as const : 'violet' as const,
      simple: true,
    },
    {
      icon: BookOpenCheck,
      label: 'Модули',
      value: skillModules.length ? `${masteredModules}/${skillModules.length}` : '—',
      detail: `${overallProgress}% среднего прогресса`,
      tone: needsHelpModules.length ? 'rose' as const : 'green' as const,
      simple: true,
    },
    {
      icon: TriangleAlert,
      label: 'Зоны внимания',
      value: String(importantSignals.length + needsHelpModules.length + pendingPractice.length),
      detail: importantSignals.length ? 'есть рекомендации для поддержки' : 'всё спокойно',
      tone: importantSignals.length ? 'rose' as const : 'green' as const,
      simple: false,
    },
    {
      icon: MessageCircle,
      label: 'Связь',
      value: unreadMessages ? `${unreadMessages}` : '0',
      detail: unreadMessages ? 'непрочитанных сообщений' : 'диалоги с педагогами в порядке',
      tone: unreadMessages ? 'yellow' as const : 'blue' as const,
      simple: false,
    },
  ]
  const parentMetrics = viewMode === 'simple'
    ? allParentMetrics.filter(metric => metric.simple)
    : allParentMetrics

  if (status === 'unknown' || !user || user.role !== 'parent') {
    return <div className="codequest-card p-6">Загружаем кабинет…</div>
  }

  return (
    <main ref={rootRef} className="brand-parent-shell">
      <div className="page-shell mx-auto w-full max-w-[96rem] space-y-6 py-6">
        <header className="parent-cabinet-hero codequest-card p-5 sm:p-6" data-motion-reveal>
          <div className="parent-cabinet-hero__copy" data-motion-hero-copy>
            <RolePill role={user.role as UserItem['role']} />
            <h1 className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">
              Семейный кабинет
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              Спокойный обзор учёбы: что уже получается, где нужен взрослый рядом и какой следующий шаг
              поддержит ребёнка без давления.
            </p>
            <div
              className="mt-4 inline-flex rounded-full border border-slate-200 bg-white p-1 text-xs font-semibold shadow-sm"
              role="tablist"
              aria-label="Режим кабинета"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'simple'}
                onClick={() => switchViewMode('simple')}
                className={`rounded-full px-4 py-1.5 transition ${
                  viewMode === 'simple'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Кратко
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'extended'}
                onClick={() => switchViewMode('extended')}
                className={`rounded-full px-4 py-1.5 transition ${
                  viewMode === 'extended'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Подробно
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {viewMode === 'simple'
                ? 'Только успехи и достижения. Подробности доступны в режиме «Подробно».'
                : 'Полный обзор: метрики, активность, сигналы, переписка, настройки.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="brand-chip brand-chip--soft">
                {selectedChild?.display_name || 'Выберите ребёнка'}
              </span>
              <span className="brand-chip brand-chip--warm">
                Фокус: {selected ? nextFocus : 'подключите код ребёнка'}
              </span>
            </div>
          </div>

          <div className="parent-cabinet-hero__visual" data-motion-hero-visual data-motion-hover>
            <div
              className="parent-progress-ring parent-progress-ring--hero"
              style={cssVars({ '--value': `${selected ? overallProgress : 0}%` })}
              role="img"
              aria-label={`Средний прогресс ${selected ? overallProgress : 0}%`}
            >
              <span>{selected ? overallProgress : 0}%</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100">
                Прогресс ребёнка
              </p>
              <p className="mt-2 text-2xl font-black leading-tight text-white">
                {selectedChild?.display_name || 'Пока нет выбранного профиля'}
              </p>
              <p className="mt-2 text-sm leading-6 text-sky-50/90">
                {selected
                  ? `${weeklyActions} учебных действий за неделю, ${masteredModules} модулей уверенно закреплены.`
                  : 'Добавьте код из кабинета ребёнка, чтобы увидеть динамику и рекомендации.'}
              </p>
            </div>
          </div>
        </header>

        {loadErr ? (
          <div className="codequest-card border border-rose-200 p-4 text-rose-800">{loadErr}</div>
        ) : null}

        <section className="parent-child-switcher codequest-card p-5 sm:p-6" data-motion-reveal>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="brand-eyebrow">Дети и доступ</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Переключайтесь между профилями и добавляйте новый детский кабинет по одноразовому коду.
              </p>
            </div>
            <span className="brand-chip brand-chip--soft">
              Подключено: {children.length}
            </span>
          </div>
          {children.length ? (
            <div className="parent-child-tabs mt-4" role="tablist" aria-label="Выбор ребёнка">
              {children.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c.id)}
                  role="tab"
                  aria-selected={selected === c.id}
                  className={`parent-child-tab ${selected === c.id ? 'parent-child-tab--active' : ''}`}
                >
                  <span>{c.display_name}</span>
                  {c.relationship_label ? <small>{c.relationship_label}</small> : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">Пока нет привязанных детей — добавьте код из кабинета ребёнка.</p>
          )}

          {profileStatus && !profileStatus.ready_to_link_child ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-slate-900">
                Завершите профиль, чтобы привязать ребёнка
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-700">
                Для привязки нужны имя, номер телефона и подтверждённый email.
                Это нужно один раз — потом вы сможете добавлять детей по их кодам.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-bold uppercase text-slate-500">Имя</span>
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-2"
                    value={profileForm.full_name}
                    onChange={e => setProfileForm(s => ({ ...s, full_name: e.target.value }))}
                    placeholder="Например, Анна"
                    autoComplete="name"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-bold uppercase text-slate-500">Телефон</span>
                  <input
                    className="w-full rounded-2xl border border-slate-200 px-4 py-2"
                    value={profileForm.phone}
                    onChange={e => setProfileForm(s => ({ ...s, phone: e.target.value }))}
                    placeholder="+7 912 345-67-89"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onSaveProfile}
                  disabled={profileSaving}
                  className="brand-button-primary disabled:opacity-50"
                >
                  {profileSaving ? 'Сохраняем…' : 'Сохранить имя и телефон'}
                </button>
                {!profileStatus.user.email_verified ? (
                  <button
                    type="button"
                    onClick={onResendVerification}
                    disabled={profileResending}
                    className="brand-button-secondary disabled:opacity-50"
                  >
                    {profileResending ? 'Отправляем…' : 'Отправить письмо подтверждения'}
                  </button>
                ) : null}
              </div>

              <ul className="mt-4 space-y-1 text-xs text-slate-600">
                <li className={profileStatus.missing_fields.includes('full_name') ? 'text-amber-700' : 'text-emerald-700'}>
                  {profileStatus.missing_fields.includes('full_name') ? '◯' : '✓'} Имя
                </li>
                <li className={profileStatus.missing_fields.includes('phone') ? 'text-amber-700' : 'text-emerald-700'}>
                  {profileStatus.missing_fields.includes('phone') ? '◯' : '✓'} Номер телефона
                </li>
                <li className={profileStatus.missing_fields.includes('email_verified') ? 'text-amber-700' : 'text-emerald-700'}>
                  {profileStatus.missing_fields.includes('email_verified') ? '◯' : '✓'} Подтверждённый email{' '}
                  ({profileStatus.user.email})
                </li>
              </ul>
            </div>
          ) : (
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
          )}
        </section>

        {selected && (
          <div className="space-y-6" data-motion-stagger>
            <section className="parent-metrics-grid" aria-label="Ключевые показатели ребёнка">
              {parentMetrics.map(metric => (
                <ParentMetricCard
                  key={metric.label}
                  icon={metric.icon}
                  label={metric.label}
                  value={metric.value}
                  detail={metric.detail}
                  tone={metric.tone}
                />
              ))}
            </section>

            {viewMode === 'extended' && (
              <div className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
                <section className="parent-week-summary codequest-card p-5 sm:p-6" data-motion-item>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="brand-eyebrow">Неделя</p>
                      <h2 className="mt-2 text-2xl font-black text-slate-900">Что важно сейчас</h2>
                    </div>
                    <span className="brand-chip brand-chip--soft">
                      {activityMinutes ? `${activityMinutes} мин` : 'время не оценено'}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-slate-800">
                    {(digest?.paragraph as string) || 'Загружаем спокойный недельный обзор…'}
                  </p>
                  <div className="parent-action-strip mt-5">
                    <Sparkles size={22} strokeWidth={2.2} />
                    <div>
                      <p>Следующий мягкий шаг</p>
                      <strong>{nextFocus}</strong>
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    {(digest?.label as string) || 'Оценка активности не является точным временем у экрана.'}
                  </p>
                </section>

                <section className="codequest-card p-5 sm:p-6" data-motion-item>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="brand-eyebrow">Динамика</p>
                      <h2 className="mt-2 text-2xl font-black text-slate-900">Активность по дням</h2>
                    </div>
                    <span className="brand-chip brand-chip--warm">
                      {trendText(weeklyActions, previousActions)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {(activity?.trend_text as string) || 'Сравниваем уроки и практику с прошлой неделей.'}
                  </p>
                  <div className="mt-5">
                    <WeekActivityChart rows={weeklyActivity} previousRows={previousWeekActivity} />
                  </div>
                  <div className="parent-chart-legend mt-4">
                    <span><i className="parent-chart-legend__dot parent-chart-legend__dot--lessons" />Уроки</span>
                    <span><i className="parent-chart-legend__dot parent-chart-legend__dot--assignments" />Практика</span>
                    <span><i className="parent-chart-legend__line" />Прошлая неделя</span>
                  </div>
                </section>
              </div>
            )}

            <section className="codequest-card p-5 sm:p-6" data-motion-item>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="brand-eyebrow">Карта навыков</p>
                  <h2 className="mt-2 text-2xl font-black text-slate-900">Модули и уверенность</h2>
                </div>
                <span className="brand-chip brand-chip--soft">
                  {needsHelpModules.length ? `Поддержать: ${needsHelpModules.length}` : 'без срочных зон'}
                </span>
              </div>
              <div className="mt-5">
                <SkillProgressPanel modules={skillModules} overallProgress={overallProgress} />
              </div>
            </section>

            {viewMode === 'extended' && (
              <div className="grid gap-6 xl:grid-cols-[0.98fr_1.02fr]">
                <section className="codequest-card p-5 sm:p-6" data-motion-item>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="brand-eyebrow">Практика</p>
                      <h2 className="mt-2 text-2xl font-black text-slate-900">Баллы и статусы</h2>
                    </div>
                    <span className="brand-chip brand-chip--soft">
                      Средний: {practiceAverageScore ? `${practiceAverageScore}%` : '—'}
                    </span>
                  </div>
                  <div className="mt-5">
                    <PracticeScoreChart items={practiceItems} />
                  </div>
                  <ul className="mt-5 space-y-2 text-sm">
                    {practiceItems.slice(0, 6).map(item => (
                      <li key={item.id} className="parent-practice-row">
                        <div className="flex min-w-0 items-center gap-3">
                          {item.assignment_image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.assignment_image_url}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-lg object-cover"
                              loading="lazy"
                              aria-hidden="true"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{item.assignment_title}</p>
                            <p className="mt-1 text-xs text-slate-500">{formatPracticeDate(item.submitted_at)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className={`parent-status-chip parent-status-chip--${practiceStatusTone(item.status)}`}>
                            {practiceStatusRu(item.status)}
                          </span>
                          <span className="parent-score-badge">{item.score}%</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="codequest-card p-5 sm:p-6" data-motion-item>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="brand-eyebrow">Поддержка</p>
                      <h2 className="mt-2 text-2xl font-black text-slate-900">Сигналы для родителя</h2>
                    </div>
                    <span className="brand-chip brand-chip--soft">
                      {importantSignals.length ? 'нужна реакция' : 'спокойно'}
                    </span>
                  </div>
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {signalItems.length ? (
                      signalItems.map((sig, i) => {
                        const severity = String(sig.severity || 'info')
                        return (
                          <li
                            key={`${String(sig.title || 'signal')}-${i}`}
                            className={`parent-signal-card parent-signal-card--${severity}`}
                          >
                            <p className="font-bold text-slate-900">{String(sig.title || 'Сигнал')}</p>
                            <p className="mt-1 text-xs uppercase text-slate-500">{severityRu(severity)}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-700">{String(sig.explanation || '')}</p>
                            <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                              {String(sig.suggested_action || '')}
                            </p>
                          </li>
                        )
                      })
                    ) : (
                      <li className="parent-empty-state sm:col-span-2">
                        Нет тревожных сигналов. Можно поддерживать привычный ритм и хвалить за регулярность.
                      </li>
                    )}
                  </ul>
                </section>
              </div>
            )}

            <div className={viewMode === 'simple' ? '' : 'grid gap-6 lg:grid-cols-2'}>
              <section className="codequest-card p-5 sm:p-6" data-motion-item>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="brand-eyebrow">Достижения</p>
                    <h2 className="mt-2 text-2xl font-black text-slate-900">Поводы похвалить</h2>
                  </div>
                  <Award className="text-sky-600" size={28} strokeWidth={2.2} aria-hidden="true" />
                </div>
                <ul className="mt-5 space-y-2">
                  {achievementItems.length ? (
                    achievementItems.map(a => (
                      <li key={String(a.id ?? a.name)} className="parent-achievement-row">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{String(a.name || 'Достижение')}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{String(a.description || '')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => shareAchievement(String(a.name || 'достижение'))}
                          className="brand-button-secondary h-9 shrink-0 px-3 text-xs"
                        >
                          Поделиться
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="parent-empty-state">
                      Достижения появятся после первых заметных шагов в уроках и практике.
                    </li>
                  )}
                </ul>
              </section>

              {viewMode === 'extended' && (
                <section className="codequest-card p-5 sm:p-6" data-motion-item>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="brand-eyebrow">Педагоги</p>
                      <h2 className="mt-2 text-2xl font-black text-slate-900">Сообщения по классам</h2>
                    </div>
                    <MessageCircle className="text-sky-600" size={28} strokeWidth={2.2} aria-hidden="true" />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Учителя классов, в которых учится выбранный ребёнок. Чат создаётся при первом сообщении.
                  </p>
                  {contactsForChild.length ? (
                    <ul className="mt-5 space-y-2 text-sm">
                      {contactsForChild.map(c => {
                        const key = `${c.classroom.id}-${c.child.id}`
                        return (
                          <li key={key} className="parent-contact-row">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900">
                                {c.teacher.full_name || 'Педагог'}{' '}
                                <span className="font-normal text-slate-500">·</span>{' '}
                                {c.classroom.name || 'Класс'}
                              </p>
                              {c.latest_preview ? (
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{c.latest_preview}</p>
                              ) : (
                                <p className="mt-1 text-xs text-slate-500">Диалог пока без сообщений.</p>
                              )}
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
                    <p className="parent-empty-state mt-5">
                      Пока нет классов, где состоит этот ребёнок. Пусть введёт код класса в своём кабинете, затем
                      обновите страницу.
                    </p>
                  )}
                </section>
              )}
            </div>

            {usefulTasks.length > 0 && (
              <section className="codequest-card p-5 sm:p-6" data-motion-item>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="brand-eyebrow">Подборка</p>
                    <h2 className="mt-2 text-2xl font-black text-slate-900">Полезные задания для ребёнка</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                      Курируемая подборка вне обязательного расписания — для интересной самостоятельной работы.
                    </p>
                  </div>
                  <Link href="/useful" className="brand-button-secondary h-9 shrink-0 px-3 text-xs">
                    Все материалы
                  </Link>
                </div>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {usefulTasks.map(task => (
                    <li
                      key={task.id}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      {task.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={task.image_url}
                          alt=""
                          className="h-24 w-full object-cover"
                          loading="lazy"
                          aria-hidden="true"
                        />
                      ) : null}
                      <div className="p-3">
                        <p className="text-sm font-bold text-slate-900">{task.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{task.summary}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {viewMode === 'extended' && (
              <div className="grid gap-6 lg:grid-cols-2">
              <section className="codequest-card p-5 sm:p-6" data-motion-item>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="brand-eyebrow">Безопасность</p>
                    <h2 className="mt-2 text-2xl font-black text-slate-900">Границы и видимость</h2>
                  </div>
                  <ShieldCheck className="text-emerald-600" size={28} strokeWidth={2.2} aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Лимиты и публичная видимость применяются к каталогу, рейтингу и учебному режиму.
                </p>
                <label className="parent-toggle-row mt-5">
                  <input
                    type="checkbox"
                    checked={Boolean(safety?.hide_child_public_profile)}
                    onChange={e => void patchSafety({ hide_child_public_profile: e.target.checked })}
                  />
                  <span>Скрыть профиль ребёнка из публичного каталога</span>
                </label>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="parent-number-field">
                    <span>Лимит мин/день</span>
                    <input
                      type="number"
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
                  <label className="parent-number-field">
                    <span>Лимит мин/нед</span>
                    <input
                      type="number"
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

              <section className="codequest-card p-5 sm:p-6" data-motion-item>
                <p className="brand-eyebrow">Согласия</p>
                <h2 className="mt-2 text-2xl font-black text-slate-900">Что показывать семье</h2>
                <div className="mt-5 grid gap-2">
                  {[
                    ['allow_notifications', 'Платформенные уведомления о ребёнке'],
                    ['allow_browser_notifications', 'Системные (браузерные) уведомления'],
                    ['allow_achievement_sharing', 'Показ достижений в удобном для семьи виде'],
                    ['allow_learning_analytics_display', 'Показ спокойной аналитики обучения'],
                    ['allow_parent_teacher_communication', 'Связь с педагогом через сообщения'],
                  ].map(([key, label]) => (
                    <label key={key} className="parent-toggle-row">
                      <input
                        type="checkbox"
                        checked={Boolean(consent?.[key as keyof typeof consent])}
                        onChange={e => void patchConsent({ [key]: e.target.checked })}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </section>
            </div>
            )}

            {viewMode === 'extended' && (
              <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
                <section className="codequest-card p-5 sm:p-6" data-motion-item>
                  <p className="brand-eyebrow">Оплата</p>
                  <p className="mt-3 text-sm leading-6 text-slate-700">
                    {String(billing?.message || 'Статус оплаты недоступен.')}
                  </p>
                </section>

                <section className="codequest-card p-5 sm:p-6" data-motion-item>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="brand-eyebrow">Уведомления</p>
                      <h2 className="mt-2 text-2xl font-black text-slate-900">Последние события</h2>
                    </div>
                    <ClipboardList className="text-sky-600" size={28} strokeWidth={2.2} aria-hidden="true" />
                  </div>
                  <ul className="mt-5 space-y-2 text-sm">
                    {noteItems.length ? (
                      noteItems.slice(0, 8).map((n, i) => (
                        <li key={`${String(n.title || 'note')}-${i}`} className="parent-note-row">
                          <p className="font-semibold text-slate-900">{String(n.title || 'Уведомление')}</p>
                          <p className="mt-1 text-slate-600">{String(n.body || '')}</p>
                        </li>
                      ))
                    ) : (
                      <li className="parent-empty-state">Новых уведомлений нет.</li>
                    )}
                  </ul>
                </section>
              </div>
            )}
          </div>
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
