'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { RolePill } from '@/components/role-pill'
import { setTheme } from '@/lib/theme'
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
  const [profile, setProfile] = useState<UserItem | null>(null)
  const [achievements, setAchievements] = useState<AchievementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    full_name: '',
    theme: 'light' as UserItem['theme'],
  })

  async function load() {
    const [profileResponse, achievementsResponse] = await Promise.all([
      api<{ user: UserItem }>('/auth/me', undefined, true),
      api<{ achievements: AchievementItem[] }>('/achievements', undefined, true),
    ])

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

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

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
      setForm({
        full_name: result.user.full_name,
        theme: result.user.theme,
      })
      setTheme(result.user.theme)
      setMessage('Изменения профиля сохранены.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить профиль.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="codequest-card p-6">Загружаем профиль...</div>
  if (error && !profile) return <div className="codequest-card p-6 text-rose-700">{error}</div>
  if (!profile) return <div className="codequest-card p-6">Профиль недоступен.</div>

  return (
    <div className="space-y-6">
      {message && <div className="codequest-card bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="codequest-card bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}

      <section className="codequest-card p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <RolePill role={profile.role} />
            <h1 className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">{profile.full_name}</h1>
            <p className="mt-2 break-words text-lg text-slate-600">
              @{profile.username} · {profile.email}
            </p>
          </div>
          <div className="grid w-full gap-3 rounded-[24px] bg-slate-900 p-5 text-white sm:max-w-sm">
            <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Прогресс</p>
            <p className="text-sm">Уровень: <span className="font-bold">{profile.level}</span></p>
            <p className="text-sm">XP: <span className="font-bold">{profile.xp}</span></p>
            <p className="text-sm">Серия: <span className="font-bold">{profile.streak} дней</span></p>
            <p className="text-sm">Достижений: <span className="font-bold">{earnedStats.earnedCount}</span></p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <form onSubmit={handleSave} className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Настройки профиля</p>
          <div className="mt-5 grid gap-4">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-600">Имя</span>
              <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-600">Тема</span>
              <select className="w-full rounded-2xl border border-slate-200 px-4 py-3" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value as UserItem['theme'] })}>
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-sm text-slate-500">Фон приложения изменится после сохранения профиля.</p>
            </label>
          </div>
          <button disabled={saving} className="mt-5 w-full rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
            {saving ? 'Сохраняем...' : 'Сохранить'}
          </button>
        </form>

        <article className="codequest-card p-6">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Достижения</p>
          <p className="mt-2 text-sm text-slate-500">Получено: {earnedStats.earnedCount} · XP: +{earnedStats.earnedXp}</p>
          <div className="mt-4 space-y-3">
            {achievements.map((item) => (
              <div key={item.id} className={`rounded-2xl border p-4 ${item.earned ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-900">{item.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.earned ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {item.earned ? 'Получено' : 'Не получено'}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold text-sky-700">+{item.xp_reward} XP</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}
