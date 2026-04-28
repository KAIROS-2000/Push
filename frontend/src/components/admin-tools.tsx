'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { UserLocalTime } from '@/components/user-local-time'

import { AdminLessonBuilder } from '@/components/admin-lesson-builder'
import { api } from '@/lib/api'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'
import type {
  AdminAdminDirectoryResponse,
  AdminAuditLogItem,
  AdminAuditLogResponse,
  AdminOverviewData,
  AdminTeacherRequestsResponse,
  AdminUserDirectoryResponse,
  AdminUserListItem,
  ModuleItem,
  PaginationMeta,
  TeacherApprovalStatus,
} from '@/types'

const USERNAME_MAX_LENGTH = 10
const DIRECTORY_PAGE_SIZE = 20
type TeacherApprovalFilter = 'all' | TeacherApprovalStatus

const STAT_LABELS: Record<string, string> = {
  users: 'Пользователи',
  students: 'Ученики',
  teachers: 'Учителя',
  teacher_requests: 'Заявки учителей',
  modules: 'Модули',
  lessons: 'Уроки',
}

const TEACHER_APPROVAL_LABELS: Record<TeacherApprovalStatus, string> = {
  pending: 'На проверке',
  approved: 'Подтверждён',
  rejected: 'Отклонён',
}

const AUDIT_ACTION_OPTIONS = [
  { value: 'all', label: 'Все действия' },
  { value: 'user_blocked', label: 'Блокировка пользователя' },
  { value: 'user_unblocked', label: 'Разблокировка пользователя' },
  { value: 'user_deleted', label: 'Удаление пользователя' },
  { value: 'teacher_request_approved', label: 'Подтверждение учителя' },
  { value: 'teacher_request_rejected', label: 'Отклонение учителя' },
  { value: 'admin_created', label: 'Создание админа' },
  { value: 'admin_blocked', label: 'Блокировка админа' },
  { value: 'admin_unblocked', label: 'Разблокировка админа' },
  { value: 'admin_deleted', label: 'Удаление админа' },
  { value: 'module_created', label: 'Создание модуля' },
  { value: 'module_published', label: 'Публикация модуля' },
  { value: 'module_unpublished', label: 'Снятие модуля с публикации' },
  { value: 'module_deleted', label: 'Удаление модуля' },
  { value: 'lesson_created', label: 'Создание урока' },
]

const AUDIT_ACTION_LABELS = Object.fromEntries(
  AUDIT_ACTION_OPTIONS.map((item) => [item.value, item.label]),
) as Record<string, string>


function buildQuery(params: Record<string, string | number | undefined>) {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    searchParams.set(key, String(value))
  })
  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}


function describeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function hasPasswordWhitespace(value: string) {
  return /\s/.test(value)
}

function accountStatusBadge(user: AdminUserListItem) {
  if (user.role === 'teacher') {
    const approvalStatus = user.teacher_approval_status ?? 'approved'
    if (approvalStatus === 'pending') {
      return { label: TEACHER_APPROVAL_LABELS.pending, modifier: 'admin-status-badge--pending' }
    }
    if (approvalStatus === 'rejected') {
      return { label: TEACHER_APPROVAL_LABELS.rejected, modifier: 'admin-status-badge--rejected' }
    }
  }

  return user.is_active
    ? { label: 'Активен', modifier: 'admin-status-badge--active' }
    : { label: 'Заблокирован', modifier: 'admin-status-badge--blocked' }
}

function PaginationControls({
  pagination,
  loading,
  onPageChange,
}: {
  pagination?: PaginationMeta
  loading: boolean
  onPageChange: (page: number) => void
}) {
  if (!pagination || pagination.total_pages <= 1) {
    return null
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
      <p className="text-sm text-slate-500">
        Страница {pagination.page} из {pagination.total_pages} · всего {pagination.total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="brand-button-secondary min-h-[2.75rem] px-4 py-2 text-sm"
          disabled={loading || pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          Назад
        </button>
        <button
          type="button"
          className="brand-button-secondary min-h-[2.75rem] px-4 py-2 text-sm"
          disabled={loading || pagination.page >= pagination.total_pages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Далее
        </button>
      </div>
    </div>
  )
}

function AccountCard({
  user,
  children,
}: {
  user: AdminUserListItem
  children?: ReactNode
}) {
  const statusBadge = accountStatusBadge(user)

  return (
    <article className="rounded-[1.75rem] border border-slate-200 bg-white/80 p-5 shadow-[0_18px_38px_rgba(17,40,93,0.06)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xl font-black text-slate-900">{user.full_name}</p>
            <span className={`admin-status-badge ${statusBadge.modifier}`}>{statusBadge.label}</span>
            <span className="brand-chip brand-chip--soft min-h-[2rem] px-3 py-1 text-[0.68rem]">
              {user.role}
            </span>
          </div>
          <div className="space-y-1 text-sm text-slate-500">
            <p className="font-semibold text-slate-700">@{user.username}</p>
            <p>{user.email}</p>
            {user.phone ? <p>{user.phone}</p> : null}
          </div>
          <div className="grid gap-2 text-sm text-slate-500 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-slate-700">Создан:</span>{' '}
              <UserLocalTime iso={user.created_at} variant="admin" />
            </p>
            <p>
              <span className="font-semibold text-slate-700">Последний вход:</span>{' '}
              <UserLocalTime iso={user.last_login_at} variant="admin" />
            </p>
            {user.teacher_rejection_expires_at ? (
              <p>
                <span className="font-semibold text-slate-700">Удалится:</span>{' '}
                <UserLocalTime iso={user.teacher_rejection_expires_at} variant="admin" />
              </p>
            ) : null}
          </div>
        </div>
        {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
      </div>
    </article>
  )
}

function DirectoryToolbar({
  title,
  description,
  username,
  status,
  total,
  loading,
  onUsernameChange,
  onStatusChange,
}: {
  title: string
  description: string
  username: string
  status: 'all' | 'active' | 'blocked'
  total?: number
  loading: boolean
  onUsernameChange: (value: string) => void
  onStatusChange: (value: 'all' | 'active' | 'blocked') => void
}) {
  return (
    <section className="codequest-card p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-3">
          <p className="brand-eyebrow">Directory</p>
          <h2 className="text-2xl font-black text-slate-900">{title}</h2>
          <p className="text-sm leading-7 text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="brand-chip brand-chip--soft">
            {loading ? 'Загрузка…' : `${total ?? 0} записей`}
          </span>
          <span className="brand-chip brand-chip--warm">поиск по логину</span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Логин пользователя</span>
          <input
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
            placeholder="Например, alice или mentor"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
          />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Статус</span>
          <select
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
            value={status}
            onChange={(event) => onStatusChange(event.target.value as 'all' | 'active' | 'blocked')}
          >
            <option value="all">Все</option>
            <option value="active">Только активные</option>
            <option value="blocked">Только заблокированные</option>
          </select>
        </label>
      </div>
    </section>
  )
}

function AuditActionBadge({ action }: { action: string }) {
  const modifier =
    action.includes('blocked') || action.includes('rejected')
      ? 'admin-action-badge--danger'
      : action.includes('deleted')
        ? 'admin-action-badge--muted'
        : action.includes('created') || action.includes('approved')
          ? 'admin-action-badge--success'
          : action.includes('published')
            ? 'admin-action-badge--primary'
            : 'admin-action-badge--warning'

  return (
    <span className={`admin-action-badge ${modifier}`}>
      {AUDIT_ACTION_LABELS[action] || action}
    </span>
  )
}

export function AdminOverviewPanel({ overview }: { overview: AdminOverviewData | null }) {
  if (!overview) {
    return (
      <section className="codequest-card p-6 sm:p-7">
        <p className="brand-eyebrow">Overview</p>
        <h2 className="mt-3 text-2xl font-black text-slate-900">Сводка временно недоступна</h2>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          Не удалось получить стартовые метрики. Попробуйте обновить страницу или заново войти в панель.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Object.entries(overview.stats).map(([label, value]) => (
          <article key={label} className="brand-stat-card codequest-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              {STAT_LABELS[label] || label}
            </p>
            <p className="mt-3 text-4xl font-black text-slate-900">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="codequest-card p-6">
          <p className="brand-eyebrow">Users</p>
          <h3 className="mt-3 text-xl font-black text-slate-900">Модерация без шума</h3>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            Поиск, блокировка и статусы пользователей теперь живут на отдельном экране и не мешают контентной работе.
          </p>
        </article>
        <article className="codequest-card p-6">
          <p className="brand-eyebrow">Content</p>
          <h3 className="mt-3 text-xl font-black text-slate-900">Уроки и модули отдельно</h3>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            У конструктора уроков и каталога модулей появились собственные поверхности без перегруженного общего полотна.
          </p>
        </article>
        <article className="codequest-card p-6">
          <p className="brand-eyebrow">Audit</p>
          <h3 className="mt-3 text-xl font-black text-slate-900">История действий под рукой</h3>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            Любое ключевое действие админских ролей оставляет запись в отдельном журнале с фильтрами и точным временем.
          </p>
        </article>
      </section>
    </div>
  )
}

export function AdminUsersPanel({
  initialData,
  canDeleteUsers = false,
}: {
  initialData: AdminUserDirectoryResponse | null
  canDeleteUsers?: boolean
}) {
  const [response, setResponse] = useState(initialData)
  const [username, setUsername] = useState(initialData?.filters.username ?? '')
  const [status, setStatus] = useState<'all' | 'active' | 'blocked'>(
    initialData?.filters.status ?? 'all',
  )
  const [page, setPage] = useState(initialData?.pagination.page ?? 1)
  const [loading, setLoading] = useState(!initialData)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const skipInitialLoad = useRef(Boolean(initialData))

  async function load(next?: {
    username?: string
    status?: 'all' | 'active' | 'blocked'
    page?: number
  }) {
    const nextUsername = next?.username ?? username
    const nextStatus = next?.status ?? status
    const nextPage = next?.page ?? page
    setLoading(true)
    try {
      const data = await api<AdminUserDirectoryResponse>(
        `/admin/users${buildQuery({
          username: nextUsername,
          status: nextStatus,
          page: nextPage,
          page_size: DIRECTORY_PAGE_SIZE,
        })}`,
        undefined,
        'required',
      )
      setResponse(data)
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось загрузить список пользователей.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (
      skipInitialLoad.current &&
      username === (initialData?.filters.username ?? '') &&
      status === (initialData?.filters.status ?? 'all') &&
      page === (initialData?.pagination.page ?? 1)
    ) {
      skipInitialLoad.current = false
      return
    }

    const timer = window.setTimeout(() => {
      void load({ username, status, page })
    }, 280)

    return () => window.clearTimeout(timer)
  }, [initialData, page, status, username])

  async function toggleUser(user: AdminUserListItem) {
    setBusyUserId(user.id)
    try {
      await api(
        `/admin/users/${user.id}/${user.is_active ? 'block' : 'unblock'}`,
        { method: 'PATCH' },
        'required',
      )
      showSuccessToast(
        user.is_active
          ? `Пользователь @${user.username} заблокирован.`
          : `Пользователь @${user.username} снова активен.`,
      )
      await load()
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось обновить статус пользователя.'))
    } finally {
      setBusyUserId(null)
    }
  }

  async function deleteUser(user: AdminUserListItem) {
    const confirmed = window.confirm(
      `Удалить пользователя @${user.username}? Это действие нельзя отменить.`,
    )
    if (!confirmed) return

    setBusyUserId(user.id)
    try {
      await api(`/admin/users/${user.id}`, { method: 'DELETE' }, 'required')
      showSuccessToast(`Пользователь @${user.username} удалён.`)
      const nextPage = (response?.users.length ?? 0) <= 1 && page > 1 ? page - 1 : page
      if (nextPage !== page) {
        setPage(nextPage)
      }
      await load({ page: nextPage })
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось удалить пользователя.'))
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="space-y-6">
      <DirectoryToolbar
        title={
          canDeleteUsers
            ? 'Поиск, блокировка и удаление учеников и учителей'
            : 'Поиск и блокировка учеников и учителей'
        }
        description={
          canDeleteUsers
            ? 'Серверная фильтрация по логину помогает быстро найти нужный аккаунт, изменить статус или удалить запись после подтверждения действия.'
            : 'Серверная фильтрация по логину помогает быстро найти нужный аккаунт, а статус виден сразу в списке без переходов между экранами.'
        }
        username={username}
        status={status}
        total={response?.pagination.total}
        loading={loading}
        onUsernameChange={(value) => {
          setUsername(value)
          setPage(1)
        }}
        onStatusChange={(value) => {
          setStatus(value)
          setPage(1)
        }}
      />

      <section className="codequest-card p-6 sm:p-7">
        <div className="space-y-4">
          {(response?.users ?? []).map((user) => (
            <AccountCard key={user.id} user={user}>
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  user.is_active ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}
                disabled={busyUserId === user.id}
                onClick={() => void toggleUser(user)}
              >
                {busyUserId === user.id
                  ? 'Сохраняем…'
                  : user.is_active
                    ? 'Блокировать'
                    : 'Разблокировать'}
              </button>
              {canDeleteUsers ? (
                <button
                  type="button"
                  className="rounded-full bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-700"
                  disabled={busyUserId === user.id}
                  onClick={() => void deleteUser(user)}
                >
                  {busyUserId === user.id ? 'Удаляем…' : 'Удалить'}
                </button>
              ) : null}
            </AccountCard>
          ))}
        </div>

        {!loading && (response?.users.length ?? 0) === 0 ? (
          <div className="mt-6 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
            <p className="text-lg font-black text-slate-900">Совпадений не найдено</p>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              Попробуйте изменить логин или переключить фильтр статуса.
            </p>
          </div>
        ) : null}

        <PaginationControls
          pagination={response?.pagination}
          loading={loading}
          onPageChange={(nextPage) => setPage(nextPage)}
        />
      </section>
    </div>
  )
}

export function AdminTeacherRequestsPanel({
  initialData,
}: {
  initialData: AdminTeacherRequestsResponse | null
}) {
  const [response, setResponse] = useState(initialData)
  const [username, setUsername] = useState(initialData?.filters.username ?? '')
  const [status, setStatus] = useState<TeacherApprovalFilter>(
    initialData?.filters.status ?? 'pending',
  )
  const [page, setPage] = useState(initialData?.pagination.page ?? 1)
  const [loading, setLoading] = useState(!initialData)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const skipInitialLoad = useRef(Boolean(initialData))

  async function load(next?: {
    username?: string
    status?: TeacherApprovalFilter
    page?: number
  }) {
    const nextUsername = next?.username ?? username
    const nextStatus = next?.status ?? status
    const nextPage = next?.page ?? page
    setLoading(true)
    try {
      const data = await api<AdminTeacherRequestsResponse>(
        `/admin/teacher-requests${buildQuery({
          username: nextUsername,
          status: nextStatus,
          page: nextPage,
          page_size: DIRECTORY_PAGE_SIZE,
        })}`,
        undefined,
        'required',
      )
      setResponse(data)
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось загрузить заявки учителей.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (
      skipInitialLoad.current &&
      username === (initialData?.filters.username ?? '') &&
      status === (initialData?.filters.status ?? 'pending') &&
      page === (initialData?.pagination.page ?? 1)
    ) {
      skipInitialLoad.current = false
      return
    }

    const timer = window.setTimeout(() => {
      void load({ username, status, page })
    }, 280)

    return () => window.clearTimeout(timer)
  }, [initialData, page, status, username])

  async function changeRequest(user: AdminUserListItem, action: 'approve' | 'reject') {
    setBusyUserId(user.id)
    try {
      await api(
        `/admin/teacher-requests/${user.id}/${action}`,
        { method: 'PATCH' },
        'required',
      )
      showSuccessToast(
        action === 'approve'
          ? `Учитель @${user.username} подтверждён.`
          : `Заявка @${user.username} отклонена и будет удалена через 15 минут.`,
      )
      await load()
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось обновить заявку учителя.'))
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="codequest-card p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-3">
            <p className="brand-eyebrow">Teacher access</p>
            <h2 className="text-2xl font-black text-slate-900">Подтверждение регистраций учителей</h2>
            <p className="text-sm leading-7 text-slate-500">
              Учитель создаёт аккаунт сам, но кабинет открывается только после решения администратора.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="brand-chip brand-chip--soft">
              {loading ? 'Загрузка…' : `${response?.pagination.total ?? 0} заявок`}
            </span>
            <span className="brand-chip brand-chip--warm">ручное подтверждение</span>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Логин учителя</span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              placeholder="Например, mentor"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Статус заявки</span>
            <select
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as TeacherApprovalFilter)
                setPage(1)
              }}
            >
              <option value="pending">Ожидают решения</option>
              <option value="approved">Подтверждённые</option>
              <option value="rejected">Отклонённые</option>
              <option value="all">Все</option>
            </select>
          </label>
        </div>
      </section>

      <section className="codequest-card p-6 sm:p-7">
        <div className="space-y-4">
          {(response?.teacher_requests ?? []).map((user) => {
            const approvalStatus = user.teacher_approval_status ?? 'approved'
            return (
              <AccountCard key={user.id} user={user}>
                {approvalStatus !== 'approved' ? (
                  <button
                    type="button"
                    className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-800"
                    disabled={busyUserId === user.id}
                    onClick={() => void changeRequest(user, 'approve')}
                  >
                    {busyUserId === user.id ? 'Сохраняем…' : 'Подтвердить'}
                  </button>
                ) : null}
                {approvalStatus === 'pending' ? (
                  <button
                    type="button"
                    className="rounded-full bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-800"
                    disabled={busyUserId === user.id}
                    onClick={() => void changeRequest(user, 'reject')}
                  >
                    {busyUserId === user.id ? 'Сохраняем…' : 'Отклонить'}
                  </button>
                ) : null}
              </AccountCard>
            )
          })}
        </div>

        {!loading && (response?.teacher_requests.length ?? 0) === 0 ? (
          <div className="mt-6 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
            <p className="text-lg font-black text-slate-900">Заявок не найдено</p>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              Измените фильтр статуса или дождитесь новой регистрации учителя.
            </p>
          </div>
        ) : null}

        <PaginationControls
          pagination={response?.pagination}
          loading={loading}
          onPageChange={(nextPage) => setPage(nextPage)}
        />
      </section>
    </div>
  )
}

export function SuperadminAdminsPanel({
  initialData,
}: {
  initialData: AdminAdminDirectoryResponse | null
}) {
  const [response, setResponse] = useState(initialData)
  const [username, setUsername] = useState(initialData?.filters.username ?? '')
  const [status, setStatus] = useState<'all' | 'active' | 'blocked'>(
    initialData?.filters.status ?? 'all',
  )
  const [page, setPage] = useState(initialData?.pagination.page ?? 1)
  const [loading, setLoading] = useState(!initialData)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    username: '',
    password: '',
  })
  const skipInitialLoad = useRef(Boolean(initialData))

  async function load(next?: {
    username?: string
    status?: 'all' | 'active' | 'blocked'
    page?: number
  }) {
    const nextUsername = next?.username ?? username
    const nextStatus = next?.status ?? status
    const nextPage = next?.page ?? page
    setLoading(true)
    try {
      const data = await api<AdminAdminDirectoryResponse>(
        `/admin/admins${buildQuery({
          username: nextUsername,
          status: nextStatus,
          page: nextPage,
          page_size: DIRECTORY_PAGE_SIZE,
        })}`,
        undefined,
        'required',
      )
      setResponse(data)
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось загрузить список администраторов.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (
      skipInitialLoad.current &&
      username === (initialData?.filters.username ?? '') &&
      status === (initialData?.filters.status ?? 'all') &&
      page === (initialData?.pagination.page ?? 1)
    ) {
      skipInitialLoad.current = false
      return
    }

    const timer = window.setTimeout(() => {
      void load({ username, status, page })
    }, 280)

    return () => window.clearTimeout(timer)
  }, [initialData, page, status, username])

  async function createAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedUsername = form.username.trim().toLowerCase()
    if (normalizedUsername.length > USERNAME_MAX_LENGTH) {
      showInfoToast(`Логин должен содержать не более ${USERNAME_MAX_LENGTH} символов.`)
      return
    }
    if (form.password.length < 12) {
      showInfoToast('Пароль должен содержать не менее 12 символов.')
      return
    }
    if (hasPasswordWhitespace(form.password)) {
      showInfoToast('Пароль не должен содержать пробелы.')
      return
    }

    try {
      await api(
        '/admin/admins',
        {
          method: 'POST',
          body: JSON.stringify({
            ...form,
            username: normalizedUsername,
          }),
        },
        'required',
      )
      setForm({ full_name: '', email: '', username: '', password: '' })
      showSuccessToast('Новый администратор создан.')
      setPage(1)
      await load({ page: 1 })
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось создать администратора.'))
    }
  }

  async function changeAdminState(user: AdminUserListItem, action: 'block' | 'unblock' | 'delete') {
    setBusyUserId(user.id)
    try {
      await api(
        `/admin/admins/${user.id}${action === 'delete' ? '' : `/${action}`}`,
        { method: action === 'delete' ? 'DELETE' : 'PATCH' },
        'required',
      )
      showSuccessToast(
        action === 'delete'
          ? `Администратор @${user.username} удалён.`
          : action === 'block'
            ? `Администратор @${user.username} заблокирован.`
            : `Администратор @${user.username} снова активен.`,
      )
      await load()
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось обновить состояние администратора.'))
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <form onSubmit={createAdmin} className="codequest-card p-6 sm:p-7">
        <p className="brand-eyebrow">Provisioning</p>
        <h2 className="mt-3 text-2xl font-black text-slate-900">Создать нового администратора</h2>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          Суперадмин выдаёт доступ отдельно от пользовательской модерации, чтобы контроль ролей не растворялся внутри общей панели.
        </p>

        <div className="mt-6 grid gap-4">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">ФИО</span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
              placeholder="Например, Мария Смирнова"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="ops@example.com"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Логин</span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={form.username}
              maxLength={USERNAME_MAX_LENGTH}
              onChange={(event) =>
                setForm({
                  ...form,
                  username: event.target.value.slice(0, USERNAME_MAX_LENGTH),
                })
              }
              placeholder="opsadmin"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Пароль</span>
            <input
              type="password"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="Минимум 12 символов"
            />
          </label>
        </div>

        <button className="brand-button-primary mt-6 w-full">Создать администратора</button>
      </form>

      <div className="space-y-6">
        <DirectoryToolbar
          title="Поиск и контроль админ-аккаунтов"
          description="Список обычных администраторов вынесен в отдельный модуль с серверным поиском по логину и быстрыми действиями по доступу."
          username={username}
          status={status}
          total={response?.pagination.total}
          loading={loading}
          onUsernameChange={(value) => {
            setUsername(value)
            setPage(1)
          }}
          onStatusChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
        />

        <section className="codequest-card p-6 sm:p-7">
          <div className="space-y-4">
            {(response?.admins ?? []).map((user) => (
              <AccountCard key={user.id} user={user}>
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    user.is_active ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                  }`}
                  disabled={busyUserId === user.id}
                  onClick={() =>
                    void changeAdminState(user, user.is_active ? 'block' : 'unblock')
                  }
                >
                  {busyUserId === user.id
                    ? 'Сохраняем…'
                    : user.is_active
                      ? 'Блокировать'
                      : 'Разблокировать'}
                </button>
                <button
                  type="button"
                  className="rounded-full bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-800"
                  disabled={busyUserId === user.id}
                  onClick={() => void changeAdminState(user, 'delete')}
                >
                  Удалить
                </button>
              </AccountCard>
            ))}
          </div>

          {!loading && (response?.admins.length ?? 0) === 0 ? (
            <div className="mt-6 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <p className="text-lg font-black text-slate-900">Администраторы не найдены</p>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Уточните логин или сбросьте фильтр статуса, чтобы увидеть больше записей.
              </p>
            </div>
          ) : null}

          <PaginationControls
            pagination={response?.pagination}
            loading={loading}
            onPageChange={(nextPage) => setPage(nextPage)}
          />
        </section>
      </div>
    </div>
  )
}

export function AdminModulesPanel({
  initialModules,
}: {
  initialModules: ModuleItem[] | null
}) {
  const [modules, setModules] = useState<ModuleItem[]>(initialModules ?? [])
  const [loading, setLoading] = useState(!initialModules)
  const [busyModuleId, setBusyModuleId] = useState<number | null>(null)
  const [moduleForm, setModuleForm] = useState({
    slug: '',
    title: '',
    description: '',
    age_group: 'middle',
    color: '#4A90D9',
  })

  const roadmapModules = modules.filter((module) => !module.is_custom_classroom_module)
  const publishedModules = roadmapModules.filter((module) => module.is_published)

  async function loadModules() {
    setLoading(true)
    try {
      const data = await api<{ modules: ModuleItem[] }>('/admin/modules', undefined, 'required')
      setModules(data.modules)
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось загрузить каталог модулей.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialModules) return
    void loadModules()
  }, [initialModules])

  async function createModule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await api(
        '/admin/modules',
        {
          method: 'POST',
          body: JSON.stringify({ ...moduleForm, is_published: false }),
        },
        'required',
      )
      setModuleForm({
        slug: '',
        title: '',
        description: '',
        age_group: 'middle',
        color: '#4A90D9',
      })
      showSuccessToast('Модуль создан.')
      await loadModules()
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось создать модуль.'))
    }
  }

  async function toggleModule(module: ModuleItem) {
    setBusyModuleId(module.id)
    try {
      await api(
        `/admin/modules/${module.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ is_published: !module.is_published }),
        },
        'required',
      )
      showSuccessToast(
        module.is_published
          ? `Модуль «${module.title}» снят с публикации.`
          : `Модуль «${module.title}» опубликован.`,
      )
      await loadModules()
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось обновить статус модуля.'))
    } finally {
      setBusyModuleId(null)
    }
  }

  async function deleteModule(module: ModuleItem) {
    if (module.is_published) {
      showInfoToast('Сначала снимите модуль с публикации.')
      return
    }

    const confirmed = window.confirm(
      `Удалить скрытый модуль «${module.title}» вместе со всеми уроками внутри?`,
    )
    if (!confirmed) return

    setBusyModuleId(module.id)
    try {
      const response = await api<{ message: string }>(
        `/admin/modules/${module.id}`,
        { method: 'DELETE' },
        'required',
      )
      showSuccessToast(response.message || 'Модуль удалён.')
      await loadModules()
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось удалить модуль.'))
    } finally {
      setBusyModuleId(null)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <form onSubmit={createModule} className="codequest-card p-6 sm:p-7">
        <p className="brand-eyebrow">New module</p>
        <h2 className="mt-3 text-2xl font-black text-slate-900">Создать новый модуль roadmap</h2>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          Модуль создаётся отдельно от списка пользователей и логов, поэтому контентные операции читаются и проверяются заметно проще.
        </p>

        <div className="mt-6 grid gap-4">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Slug</span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={moduleForm.slug}
              onChange={(event) => setModuleForm({ ...moduleForm, slug: event.target.value })}
              placeholder="middle-python-basics"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Название</span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={moduleForm.title}
              onChange={(event) => setModuleForm({ ...moduleForm, title: event.target.value })}
              placeholder="Python: основы цикла"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Описание</span>
            <textarea
              className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={moduleForm.description}
              onChange={(event) =>
                setModuleForm({ ...moduleForm, description: event.target.value })
              }
              placeholder="Коротко объясните, чему научится ученик."
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Возрастная группа</span>
              <select
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={moduleForm.age_group}
                onChange={(event) =>
                  setModuleForm({ ...moduleForm, age_group: event.target.value })
                }
              >
                <option value="junior">junior</option>
                <option value="middle">middle</option>
                <option value="senior">senior</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Цвет</span>
              <input
                className="h-[3.3rem] w-full rounded-2xl border border-slate-200 px-2 py-2"
                type="color"
                value={moduleForm.color}
                onChange={(event) => setModuleForm({ ...moduleForm, color: event.target.value })}
              />
            </label>
          </div>
        </div>

        <button className="brand-button-primary mt-6 w-full">Создать модуль</button>
      </form>

      <div className="space-y-6">
        <section className="codequest-card p-6 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="brand-eyebrow">Catalog</p>
              <h2 className="text-2xl font-black text-slate-900">Каталог модулей и публикация</h2>
              <p className="text-sm leading-7 text-slate-500">
                Здесь остаются только операции над самими модулями: что уже видно в roadmap и что пока скрыто.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="brand-chip brand-chip--soft">
                {loading ? 'Загрузка…' : `${roadmapModules.length} модулей`}
              </span>
              <span className="brand-chip brand-chip--warm">{publishedModules.length} опубликовано</span>
            </div>
          </div>
        </section>

        <section className="codequest-card p-6 sm:p-7">
          <div className="space-y-4">
            {roadmapModules.map((module) => (
              <article
                key={module.id}
                className="rounded-[1.75rem] border border-slate-200 bg-white/80 p-5 shadow-[0_18px_38px_rgba(17,40,93,0.06)]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xl font-black text-slate-900">{module.title}</p>
                      <span
                        className={`admin-status-badge ${
                          module.is_published
                            ? 'admin-status-badge--active'
                            : 'admin-status-badge--blocked'
                        }`}
                      >
                        {module.is_published ? 'Опубликован' : 'Скрыт'}
                      </span>
                    </div>
                    <p className="text-sm leading-7 text-slate-500">{module.description}</p>
                    <div className="flex flex-wrap gap-2 text-sm text-slate-500">
                      <span className="brand-chip brand-chip--soft min-h-[2rem] px-3 py-1 text-[0.68rem]">
                        {module.age_group}
                      </span>
                      <span className="brand-chip brand-chip--soft min-h-[2rem] px-3 py-1 text-[0.68rem]">
                        {module.lessons.length} уроков
                      </span>
                      <span className="brand-chip brand-chip--soft min-h-[2rem] px-3 py-1 text-[0.68rem]">
                        {module.slug}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded-full px-4 py-2 text-sm font-semibold ${
                        module.is_published ? 'bg-slate-100 text-slate-900' : 'bg-slate-900 text-white'
                      }`}
                      disabled={busyModuleId === module.id}
                      onClick={() => void toggleModule(module)}
                    >
                      {busyModuleId === module.id
                        ? 'Сохраняем…'
                        : module.is_published
                          ? 'Снять с публикации'
                          : 'Опубликовать'}
                    </button>
                    {!module.is_published ? (
                      <button
                        type="button"
                        className="rounded-full bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-800"
                        disabled={busyModuleId === module.id}
                        onClick={() => void deleteModule(module)}
                      >
                        Удалить
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>

          {!loading && roadmapModules.length === 0 ? (
            <div className="mt-6 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
              <p className="text-lg font-black text-slate-900">Пока нет модулей roadmap</p>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Создайте первый модуль слева, и он сразу появится в каталоге публикации.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

export function AdminLessonsPanel({
  initialModules,
  moduleHubHref,
}: {
  initialModules: ModuleItem[] | null
  moduleHubHref: string
}) {
  const [modules, setModules] = useState<ModuleItem[]>(initialModules ?? [])
  const [loading, setLoading] = useState(!initialModules)

  const roadmapModules = modules.filter((module) => !module.is_custom_classroom_module)

  async function loadModules() {
    setLoading(true)
    try {
      const data = await api<{ modules: ModuleItem[] }>('/admin/modules', undefined, 'required')
      setModules(data.modules)
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось загрузить модули для конструктора уроков.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialModules) return
    void loadModules()
  }, [initialModules])

  return (
    <div className="space-y-6">
      <section className="codequest-card p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="brand-eyebrow">Lesson builder</p>
            <h2 className="text-2xl font-black text-slate-900">Конструктор уроков</h2>
            <p className="text-sm leading-7 text-slate-500">
              На этом экране остаётся только создание уроков: выбор модуля, теория, практика и квиз без примеси блокировок, ролей и логов.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="brand-chip brand-chip--soft">
              {loading ? 'Загрузка…' : `${roadmapModules.length} доступных модулей`}
            </span>
            <Link href={moduleHubHref} className="brand-button-ghost min-h-[2.8rem] px-4 py-2 text-sm">
              Перейти к модулям
            </Link>
          </div>
        </div>
      </section>

      {roadmapModules.length > 0 ? (
        <AdminLessonBuilder modules={roadmapModules} onReload={loadModules} />
      ) : (
        <section className="codequest-card p-8 text-center">
          <p className="text-lg font-black text-slate-900">Сначала подготовьте хотя бы один модуль</p>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            Конструктор уроков работает только с общими roadmap-модулями. Создайте модуль и вернитесь сюда.
          </p>
          <div className="mt-6">
            <Link href={moduleHubHref} className="brand-button-primary px-5 py-3 text-sm">
              Открыть модульный каталог
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}

function renderAuditSummary(log: AdminAuditLogItem) {
  const actorLabel = log.actor.full_name || (log.actor.username ? `@${log.actor.username}` : log.actor_role)
  const targetLabel =
    log.target.full_name || (log.target.username ? `@${log.target.username}` : log.entity_label)
  const actionLabel = AUDIT_ACTION_LABELS[log.action] || log.action
  return `${actorLabel} · ${actionLabel} · ${targetLabel}`
}

export function AdminAuditLogPanel({
  initialData,
}: {
  initialData: AdminAuditLogResponse | null
}) {
  const [response, setResponse] = useState(initialData)
  const [action, setAction] = useState(initialData?.filters.action ?? 'all')
  const [actorRole, setActorRole] = useState(initialData?.filters.actor_role ?? 'all')
  const [target, setTarget] = useState(initialData?.filters.target ?? '')
  const [page, setPage] = useState(initialData?.pagination.page ?? 1)
  const [loading, setLoading] = useState(!initialData)
  const skipInitialLoad = useRef(Boolean(initialData))

  async function load(next?: {
    action?: string
    actorRole?: string
    target?: string
    page?: number
  }) {
    const nextAction = next?.action ?? action
    const nextActorRole = next?.actorRole ?? actorRole
    const nextTarget = next?.target ?? target
    const nextPage = next?.page ?? page
    setLoading(true)
    try {
      const data = await api<AdminAuditLogResponse>(
        `/admin/audit-logs${buildQuery({
          action: nextAction,
          actor_role: nextActorRole,
          target: nextTarget,
          page: nextPage,
          page_size: DIRECTORY_PAGE_SIZE,
        })}`,
        undefined,
        'required',
      )
      setResponse(data)
    } catch (error) {
      showErrorToast(describeError(error, 'Не удалось загрузить журнал действий.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (
      skipInitialLoad.current &&
      action === (initialData?.filters.action ?? 'all') &&
      actorRole === (initialData?.filters.actor_role ?? 'all') &&
      target === (initialData?.filters.target ?? '') &&
      page === (initialData?.pagination.page ?? 1)
    ) {
      skipInitialLoad.current = false
      return
    }

    const timer = window.setTimeout(() => {
      void load({ action, actorRole, target, page })
    }, 280)

    return () => window.clearTimeout(timer)
  }, [action, actorRole, initialData, page, target])

  return (
    <div className="space-y-6">
      <section className="codequest-card p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-3">
            <p className="brand-eyebrow">Audit log</p>
            <h2 className="text-2xl font-black text-slate-900">Журнал действий админских ролей</h2>
            <p className="text-sm leading-7 text-slate-500">
              Здесь видна история блокировок, создания админов, публикации модулей и появления новых уроков с фильтрами по действию, роли и цели.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="brand-chip brand-chip--soft">
              {loading ? 'Загрузка…' : `${response?.pagination.total ?? 0} записей`}
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-[14rem_14rem_minmax(0,1fr)]">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Действие</span>
            <select
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={action}
              onChange={(event) => {
                setAction(event.target.value)
                setPage(1)
              }}
            >
              {AUDIT_ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Роль исполнителя</span>
            <select
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              value={actorRole}
              onChange={(event) => {
                setActorRole(event.target.value)
                setPage(1)
              }}
            >
              <option value="all">Все роли</option>
              <option value="admin">admin</option>
              <option value="superadmin">superadmin</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Цель</span>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              placeholder="Логин пользователя или название модуля"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value)
                setPage(1)
              }}
            />
          </label>
        </div>
      </section>

      <section className="codequest-card p-6 sm:p-7">
        <div className="space-y-4">
          {(response?.audit_logs ?? []).map((log) => (
            <details
              key={log.id}
              className="admin-log-entry rounded-[1.75rem] border border-slate-200 bg-white/85 p-5"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <AuditActionBadge action={log.action} />
                      <span className="brand-chip brand-chip--soft min-h-[2rem] px-3 py-1 text-[0.68rem]">
                        {log.actor_role}
                      </span>
                    </div>
                    <p className="text-lg font-black text-slate-900">{renderAuditSummary(log)}</p>
                    <p className="text-sm leading-7 text-slate-500">
                      {log.entity_type} #{log.entity_id ?? '—'} · <UserLocalTime iso={log.created_at} variant="admin" />
                    </p>
                  </div>
                  <div className="text-sm font-semibold text-slate-500">Показать детали</div>
                </div>
              </summary>

              <div className="mt-5 grid gap-3 border-t border-slate-200 pt-5 text-sm text-slate-600 sm:grid-cols-2">
                {Object.entries(log.details).map(([key, value]) => (
                  <div key={key} className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                      {key}
                    </p>
                    <p className="mt-2 break-words font-semibold text-slate-700">
                      {String(value ?? '—')}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>

        {!loading && (response?.audit_logs.length ?? 0) === 0 ? (
          <div className="mt-6 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
            <p className="text-lg font-black text-slate-900">Записи не найдены</p>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              Попробуйте ослабить фильтры по действию, роли или цели.
            </p>
          </div>
        ) : null}

        <PaginationControls
          pagination={response?.pagination}
          loading={loading}
          onPageChange={(nextPage) => setPage(nextPage)}
        />
      </section>
    </div>
  )
}
