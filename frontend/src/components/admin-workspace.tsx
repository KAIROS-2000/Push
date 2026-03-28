'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { AdminLessonComposer } from '@/components/admin-lesson-composer'
import { api } from '@/lib/api'
import { ModuleItem, UserItem } from '@/types'

interface OverviewData {
  stats: {
    users: number
    students: number
    teachers: number
    modules: number
    lessons: number
  }
}

function hasPasswordWhitespace(value: string) {
  return /\s/.test(value)
}

export function AdminWorkspace({ superMode = false }: { superMode?: boolean }) {
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [modules, setModules] = useState<ModuleItem[]>([])
  const [users, setUsers] = useState<UserItem[]>([])
  const [message, setMessage] = useState('')
  const [moduleForm, setModuleForm] = useState({ slug: '', title: '', description: '', age_group: 'middle', color: '#4A90D9' })
  const [adminForm, setAdminForm] = useState({ full_name: '', email: '', username: '', password: '' })
  const messageIsError = /^не удалось|^ошибка/i.test(message.trim())
  const roadmapModules = modules.filter((module) => !module.is_custom_classroom_module)

  async function load() {
    const [overviewData, modulesData] = await Promise.all([
      api<OverviewData>('/admin/overview', undefined, true),
      api<{ modules: ModuleItem[] }>('/admin/modules', undefined, true),
    ])
    setOverview(overviewData)
    setModules(modulesData.modules)
    try {
      const usersData = await api<{ users: UserItem[] }>('/admin/users', undefined, true)
      setUsers(usersData.users)
    } catch {
      setUsers([])
    }
  }

  useEffect(() => {
    load().catch(() => setMessage('Не удалось загрузить админ-панель. Проверьте права доступа и авторизацию.'))
  }, [])

  async function createModule(event: FormEvent) {
    event.preventDefault()
    await api('/admin/modules', { method: 'POST', body: JSON.stringify({ ...moduleForm, is_published: false }) }, true)
    setModuleForm({ slug: '', title: '', description: '', age_group: 'middle', color: '#4A90D9' })
    setMessage('Модуль создан.')
    await load()
  }

  async function toggleModule(moduleId: number, isPublished: boolean) {
    await api(`/admin/modules/${moduleId}`, { method: 'PATCH', body: JSON.stringify({ is_published: !isPublished }) }, true)
    await load()
  }

  async function deleteModule(module: ModuleItem) {
    if (module.is_published) {
      setMessage('Сначала снимите модуль с публикации.')
      return
    }

    const confirmed = window.confirm(`Удалить скрытый модуль "${module.title}"? Это удалит все уроки, практику и квизы внутри него.`)
    if (!confirmed) return

    try {
      const response = await api<{ message: string }>(`/admin/modules/${module.id}`, { method: 'DELETE' }, true)
      setMessage(response.message || 'Модуль удалён.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка удаления модуля.')
    }
  }

  async function createAdmin(event: FormEvent) {
    event.preventDefault()
    if (adminForm.password.length < 8) {
      setMessage('Пароль должен содержать не менее 8 символов.')
      return
    }
    if (hasPasswordWhitespace(adminForm.password)) {
      setMessage('Пароль не должен содержать пробелы.')
      return
    }
    await api('/admin/admins', { method: 'POST', body: JSON.stringify(adminForm) }, true)
    setAdminForm({ full_name: '', email: '', username: '', password: '' })
    setMessage('Админ создан.')
    await load()
  }

  async function changeAdminState(userId: number, action: 'block' | 'unblock' | 'delete') {
    await api(`/admin/admins/${userId}${action === 'delete' ? '' : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'PATCH' }, true)
    setMessage(`Действие ${action} выполнено.`)
    await load()
  }

  return (
    <div className="space-y-6">
      {message && <div className={`codequest-card p-4 text-sm font-semibold ${messageIsError ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{message}</div>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {overview && Object.entries(overview.stats).map(([label, value]) => (
          <div key={label} className="codequest-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-black text-slate-900">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <form onSubmit={createModule} className="codequest-card p-6">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">Новый модуль</p>
            <div className="mt-4 grid gap-3">
              <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="slug" value={moduleForm.slug} onChange={(e) => setModuleForm({ ...moduleForm, slug: e.target.value })} />
              <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Название" value={moduleForm.title} onChange={(e) => setModuleForm({ ...moduleForm, title: e.target.value })} />
              <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Описание" value={moduleForm.description} onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select className="rounded-2xl border border-slate-200 px-4 py-3" value={moduleForm.age_group} onChange={(e) => setModuleForm({ ...moduleForm, age_group: e.target.value })}>
                  <option value="junior">junior</option>
                  <option value="middle">middle</option>
                  <option value="senior">senior</option>
                </select>
                <input className="rounded-2xl border border-slate-200 px-4 py-3" type="color" value={moduleForm.color} onChange={(e) => setModuleForm({ ...moduleForm, color: e.target.value })} />
              </div>
            </div>
            <button className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Создать модуль</button>
          </form>

          <AdminLessonComposer modules={roadmapModules} onMessage={setMessage} onReload={load} />

          {superMode && (
            <form onSubmit={createAdmin} className="codequest-card p-6">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-rose-600">Создать администратора</p>
              <div className="mt-4 grid gap-3">
                <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="ФИО" value={adminForm.full_name} onChange={(e) => setAdminForm({ ...adminForm, full_name: e.target.value })} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Email" value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} />
                  <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Username" value={adminForm.username} onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })} />
                </div>
                <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Пароль (минимум 8 символов, без пробелов)" value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} />
              </div>
              <button className="mt-4 rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white">Создать админа</button>
            </form>
          )}
        </div>

        <div className="space-y-6">
          <section className="codequest-card p-6">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">Каталог модулей</p>
            <div className="mt-4 space-y-3">
              {roadmapModules.map((module) => (
                <div key={module.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-slate-900">{module.title}</p>
                      <p className="text-sm text-slate-500">{module.age_group} · {module.lessons.length} уроков · {module.is_published ? 'в roadmap' : 'скрыт'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => toggleModule(module.id, module.is_published)} className={`rounded-full px-4 py-2 text-sm font-semibold ${module.is_published ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-900 text-white'}`}>
                        {module.is_published ? 'Снять с публикации' : 'Опубликовать'}
                      </button>
                      {!module.is_published && (
                        <button type="button" onClick={() => deleteModule(module)} className="rounded-full bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-700">
                          Удалить
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {superMode && (
            <section className="codequest-card p-6">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-rose-600">Управление админами</p>
              <div className="mt-4 space-y-3">
                {users.filter((user) => user.role === 'admin').map((user) => (
                  <div key={user.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-900">{user.full_name}</p>
                        <p className="text-sm text-slate-500">@{user.username} · {user.email}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => changeAdminState(user.id, user.is_active ? 'block' : 'unblock')} className="rounded-full bg-amber-100 px-3 py-2 text-xs font-bold text-amber-700">{user.is_active ? 'Блокировать' : 'Разблокировать'}</button>
                        <button onClick={() => changeAdminState(user.id, 'delete')} className="rounded-full bg-rose-100 px-3 py-2 text-xs font-bold text-rose-700">Удалить</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  )
}
