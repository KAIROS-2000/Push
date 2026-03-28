'use client'

import { FormEvent, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { api } from '@/lib/api'
import { queueMascotScenario } from '@/lib/mascot'
import { saveTokens } from '@/lib/storage'
import { setTheme } from '@/lib/theme'
import { AuthOptions, UserItem } from '@/types'

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const PASSWORD_WHITESPACE_RE = /\s/

function strengthLabel(password: string) {
  if (password.length < 6) return 'Слабый'
  const score = [/[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length
  if (score >= 2) return 'Сильный'
  return 'Средний'
}

function isValidEmail(value: string) {
  return EMAIL_RE.test(value.trim().toLowerCase())
}

function hasPasswordWhitespace(value: string) {
  return PASSWORD_WHITESPACE_RE.test(value)
}

export function AuthForm({ mode, options }: { mode: 'login' | 'register'; options?: AuthOptions }) {
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    username: '',
    email: '',
    password: '',
    role: 'student',
    age_group: 'middle',
    theme: 'light' as UserItem['theme'],
  })
  const isTeacherRegistration = mode === 'register' && form.role === 'teacher'

  const strength = useMemo(() => strengthLabel(form.password), [form.password])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const normalizedCredential = form.email.trim().toLowerCase()
    if (mode === 'register' && !isValidEmail(normalizedCredential)) {
      setError('Укажите корректный email.')
      return
    }
    if (mode === 'register' && form.password.length < 6) {
      setError('Пароль должен содержать не менее 6 символов.')
      return
    }
    if (mode === 'register' && hasPasswordWhitespace(form.password)) {
      setError('Пароль не должен содержать пробелы.')
      return
    }
    if (mode === 'register' && !isTeacherRegistration && !form.age_group) {
      setError('Выберите возрастную группу ученика.')
      return
    }
    if (mode === 'login' && !normalizedCredential) {
      setError('Укажите email или username.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const payload =
        mode === 'login'
          ? { login: normalizedCredential, password: form.password }
          : {
              full_name: form.full_name,
              username: form.username,
              email: normalizedCredential,
              password: form.password,
              role: form.role,
              theme: form.theme,
              ...(isTeacherRegistration ? {} : { age_group: form.age_group }),
            }

      const result = await api<{ access_token: string; refresh_token: string; user: UserItem }>('/auth/' + mode, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      saveTokens(result.access_token, result.refresh_token)
      setTheme(result.user?.theme || form.theme)
      if (mode === 'register' && result.user?.role === 'student') {
        queueMascotScenario('post_register_intro')
      }
      window.location.href = '/dashboard'
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить действие')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="order-2 codequest-card grid-bg min-w-0 overflow-hidden p-6 text-slate-900 sm:p-8 lg:order-1">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-white shadow-lg shadow-sky-200 ring-1 ring-sky-100">
              <Image
                src="/kodiums-logo.png"
                alt="Логотип Кодиумс"
                width={48}
                height={48}
                className="h-12 w-12 rounded-full object-cover"
                priority
              />
            </div>
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-sky-600">Кодиумс</p>
          </div>
          <h1 className="mt-3 text-[1.65rem] font-black leading-[1.05] tracking-[-0.03em] sm:text-4xl">
            {mode === 'login' ? 'С возвращением!' : 'Создай аккаунт и начни путь'}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Платформа объединяет регистрацию, уроки, задания, тесты, XP, уровни и классы с учителем в одном красивом интерфейсе.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              ['24/7', 'доступ к платформе'],
              ['3', 'возрастные группы'],
              ['4', 'роли доступа'],
              ['∞', 'рост проекта'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-[24px] bg-white/90 p-5 shadow-lg">
                <p className="text-3xl font-black text-slate-900">{value}</p>
                <p className="mt-1 text-sm text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="order-1 codequest-card min-w-0 p-6 sm:p-8 lg:order-2">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-sky-600">{mode === 'login' ? 'Вход' : 'Регистрация'}</p>
              <h2 className="mt-1 text-2xl font-black text-slate-900 sm:text-3xl">{mode === 'login' ? 'Войти в аккаунт' : 'Заполнить профиль'}</h2>
            </div>
            <Link href={mode === 'login' ? '/auth/register' : '/auth/login'} className="inline-flex w-full justify-center rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 sm:w-auto">
              {mode === 'login' ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}
            </Link>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-600">Имя</span>
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-600">Username</span>
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </label>
              </div>
            )}

            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-600">{mode === 'login' ? 'Email или Username' : 'Email'}</span>
                <input
                  type={mode === 'login' ? 'text' : 'email'}
                  placeholder={mode === 'login' ? 'Введите email или username' : undefined}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              {mode === 'register' && (
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-600">Роль</span>
                  <select className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    {options?.roles?.map((role) => (
                      <option key={role} value={role}>{role === 'student' ? 'Ученик' : 'Учитель'}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-600">Пароль</span>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <input className="w-full" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="shrink-0 text-sm font-semibold text-sky-600" onClick={() => setShowPassword((item) => !item)}>
                  {showPassword ? 'Скрыть' : 'Показать'}
                </button>
              </div>
              {mode === 'register' && <p className="text-sm text-slate-500">Надёжность пароля: <span className="font-semibold text-slate-900">{strength}</span></p>}
              {mode === 'register' && <p className="text-sm text-slate-500">Минимум 6 символов, без пробелов.</p>}
            </label>

            {mode === 'register' && !isTeacherRegistration && (
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-600">Возрастная группа</span>
                <select className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" value={form.age_group} onChange={(e) => setForm({ ...form, age_group: e.target.value })}>
                  {(options?.age_groups || ['junior', 'middle', 'senior']).map((ageGroup) => (
                    <option key={ageGroup} value={ageGroup}>
                      {ageGroup === 'junior' ? 'Младшая 7–10' : ageGroup === 'middle' ? 'Средняя 11–13' : 'Старшая 14–15'}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {error && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>}

            <button disabled={loading} className="mt-3 w-full rounded-2xl bg-slate-900 px-5 py-3 text-base font-bold text-white shadow-lg shadow-slate-300 disabled:opacity-60">
              {loading ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
