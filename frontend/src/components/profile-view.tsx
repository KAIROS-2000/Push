'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { fetchSessionUser } from '@/lib/auth-session'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { RolePill } from '@/components/role-pill'
import { setAnonymousSession, setAuthenticatedSession } from '@/lib/session-store'
import { setTheme } from '@/lib/theme'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { UserItem } from '@/types'

interface AchievementItem {
  id: number
  name: string
  description: string
  xp_reward: number
  earned: boolean
}

const THEME_OPTIONS: Array<{ value: UserItem['theme']; label: string }> = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Темная' },
]

export function ProfileView() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [profile, setProfile] = useState<UserItem | null>(null)
  const [achievements, setAchievements] = useState<AchievementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    full_name: '',
    theme: 'light' as UserItem['theme'],
  })

  async function load() {
    const [profileResponse, achievementsResponse] = await Promise.all([
      fetchSessionUser({ auth: 'required' }).then((user) => ({ user })),
      api<{ achievements: AchievementItem[] }>('/achievements', undefined, true),
    ])

    if (!profileResponse.user) {
      throw new Error('Не удалось загрузить профиль.')
    }

    setProfile(profileResponse.user)
    setForm({
      full_name: profileResponse.user.full_name,
      theme: profileResponse.user.theme,
    })
    setTheme(profileResponse.user.theme)
    setAchievements(achievementsResponse.achievements)
  }

  useEffect(() => {
    load()
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить профиль.'))
      .finally(() => setLoading(false))
  }, [])

  const earnedStats = useMemo(() => {
    const earned = achievements.filter((item) => item.earned)
    const earnedXp = earned.reduce((sum, item) => sum + item.xp_reward, 0)
    return { earnedCount: earned.length, earnedXp }
  }, [achievements])

  useUserPageMotion(rootRef, [Boolean(profile), achievements.length])

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setSaving(true)

    try {
      const result = await api<{ user: UserItem }>(
        '/users/me',
        {
          method: 'PATCH',
          body: JSON.stringify(form),
        },
        true,
      )

      setProfile(result.user)
      setAuthenticatedSession(result.user)
      setForm({
        full_name: result.user.full_name,
        theme: result.user.theme,
      })
      setTheme(result.user.theme)
      showSuccessToast('Изменения профиля сохранены.')
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : 'Не удалось сохранить профиль.')
    } finally {
      setSaving(false)
    }
  }

  async function handleLogout() {
    const confirmed = window.confirm('Вы уверены, что хотите выйти из учетной записи?')
    if (!confirmed) return

    setLoggingOut(true)

    try {
      await api('/auth/logout', { method: 'POST' }, 'required')
    } catch {
      // If the session is already invalid, still send the user to login.
    } finally {
      setAnonymousSession()
      window.location.href = '/auth/login'
    }
  }

  if (loading) return <div className="codequest-card p-6">Загружаем профиль...</div>
  if (error && !profile) return <div className="codequest-card p-6 text-rose-700">{error}</div>
  if (!profile) return <div className="codequest-card p-6">Профиль недоступен.</div>

  return (
    <div ref={rootRef} className="space-y-6">
      <section className="profile-identity codequest-card p-5 sm:p-8" data-motion-reveal>
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div data-motion-hero-copy>
            <RolePill role={profile.role} />
            <h1 className="mt-4 text-4xl font-black leading-tight text-slate-900 sm:text-5xl">
              {profile.full_name}
            </h1>
            <p className="mt-3 break-words text-base leading-7 text-slate-600 sm:text-lg">
              @{profile.username} · {profile.email}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="brand-chip brand-chip--soft">уровень {profile.level}</span>
              <span className="brand-chip brand-chip--soft">{profile.streak} дней подряд</span>
              <span className="brand-chip brand-chip--warm">+{earnedStats.earnedXp} XP из достижений</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2" data-motion-stagger>
            {[
              ['Текущий ранг', profile.rank_title],
              ['Всего XP', String(profile.xp)],
              ['Получено достижений', String(earnedStats.earnedCount)],
              ['Тема кабинета', form.theme === 'light' ? 'Светлая' : 'Темная'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[24px] bg-slate-50 p-4" data-motion-item data-motion-hover>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                <p className="mt-3 text-lg font-black text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]" data-motion-stagger>
        <form onSubmit={handleSave} className="codequest-card p-6" data-motion-item>
          <p className="brand-eyebrow">Настройки</p>
          <h2 className="mt-3 text-2xl font-black text-slate-900">Личные данные и тема интерфейса</h2>
          <div className="mt-5 grid gap-4">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-600">Имя</span>
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-600">Тема</span>
              <select
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={form.theme}
                onChange={(e) => setForm({ ...form, theme: e.target.value as UserItem['theme'] })}
              >
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-sm leading-7 text-slate-500">
                Фон приложения изменится после сохранения профиля.
              </p>
            </label>
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button disabled={saving || loggingOut} className="brand-button-primary w-full sm:w-auto">
              {saving ? 'Сохраняем...' : 'Сохранить изменения'}
            </button>
            <button
              type="button"
              disabled={saving || loggingOut}
              onClick={() => void handleLogout()}
              className="brand-button-secondary w-full sm:w-auto"
            >
              {loggingOut ? 'Выходим...' : 'Выйти'}
            </button>
          </div>
        </form>

        <article className="codequest-card p-6" data-motion-item>
          <p className="brand-eyebrow">Достижения</p>
          <h2 className="mt-3 text-2xl font-black text-slate-900">История роста и собранных наград</h2>
          <p className="mt-3 text-sm leading-7 text-slate-500">
            Получено: {earnedStats.earnedCount} · XP: +{earnedStats.earnedXp}
          </p>
          <div className="mt-5 space-y-3">
            {achievements.map((item) => (
              <div
                key={item.id}
                className={`rounded-[24px] border p-4 ${
                  item.earned ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="break-words font-black text-slate-900">{item.name}</p>
                    <p className="mt-1 text-sm leading-7 text-slate-600">{item.description}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      item.earned ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.earned ? 'Получено' : 'Не получено'}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-sky-700">+{item.xp_reward} XP</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}
