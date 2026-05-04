'use client'

// Minimal admin CRUD for useful tasks (P2). Intentionally no rich-text editor —
// admins paste markdown into a textarea, the public detail page renders it as
// plain text; richer rendering can be added later without breaking the API.

import { useCallback, useEffect, useState } from 'react'

import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { UsefulAgeGroup, UsefulDifficulty, UsefulTaskItem } from '@/types'

type AdminListResponse = { tasks: UsefulTaskItem[] }
type SaveResponse = { task: UsefulTaskItem }

const AGE_GROUP_OPTIONS: UsefulAgeGroup[] = ['junior', 'middle', 'senior']
const DIFFICULTY_OPTIONS: UsefulDifficulty[] = ['easy', 'medium', 'hard']

type Draft = {
  id: number | null
  title: string
  slug: string
  summary: string
  body: string
  external_url: string
  age_groups: UsefulAgeGroup[]
  topic: string
  difficulty: UsefulDifficulty
  is_published: boolean
}

const EMPTY_DRAFT: Draft = {
  id: null,
  title: '',
  slug: '',
  summary: '',
  body: '',
  external_url: '',
  age_groups: [],
  topic: '',
  difficulty: 'medium',
  is_published: false,
}

export function AdminUsefulTasks() {
  const [items, setItems] = useState<UsefulTaskItem[]>([])
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [loadErr, setLoadErr] = useState('')

  const refresh = useCallback(async () => {
    setLoadErr('')
    try {
      const data = await api<AdminListResponse>('/useful/admin', undefined, 'required')
      setItems(data.tasks || [])
    } catch (e) {
      setLoadErr(getApiErrorMessage(e, 'Не удалось загрузить список.'))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startEdit = (task: UsefulTaskItem) => {
    setDraft({
      id: task.id,
      title: task.title,
      slug: task.slug,
      summary: task.summary || '',
      body: task.body || '',
      external_url: task.external_url || '',
      age_groups: [...task.age_groups],
      topic: task.topic || '',
      difficulty: task.difficulty,
      is_published: task.is_published,
    })
  }

  const resetDraft = () => setDraft(EMPTY_DRAFT)

  const onSave = async () => {
    if (!draft.title.trim()) {
      showErrorToast('Укажите название.')
      return
    }
    setBusy(true)
    try {
      const body = JSON.stringify({
        title: draft.title.trim(),
        slug: draft.slug.trim() || undefined,
        summary: draft.summary,
        body: draft.body,
        external_url: draft.external_url.trim() || null,
        age_groups: draft.age_groups,
        topic: draft.topic.trim() || null,
        difficulty: draft.difficulty,
        is_published: draft.is_published,
      })
      if (draft.id) {
        await api<SaveResponse>(
          `/useful/admin/${draft.id}`,
          { method: 'PATCH', body },
          'required',
        )
        showSuccessToast('Задание обновлено.')
      } else {
        await api<SaveResponse>('/useful/admin', { method: 'POST', body }, 'required')
        showSuccessToast('Задание создано.')
      }
      resetDraft()
      await refresh()
    } catch (e) {
      showErrorToast(getApiErrorMessage(e, 'Не удалось сохранить.'))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: number) => {
    if (!confirm('Удалить запись?')) return
    setBusy(true)
    try {
      await api(`/useful/admin/${id}`, { method: 'DELETE' }, 'required')
      showSuccessToast('Удалено.')
      await refresh()
      if (draft.id === id) resetDraft()
    } catch (e) {
      showErrorToast(getApiErrorMessage(e, 'Не удалось удалить.'))
    } finally {
      setBusy(false)
    }
  }

  const toggleAgeGroup = (group: UsefulAgeGroup) => {
    setDraft(current => {
      const has = current.age_groups.includes(group)
      const nextGroups = has
        ? current.age_groups.filter(g => g !== group)
        : [...current.age_groups, group]
      return { ...current, age_groups: nextGroups }
    })
  }

  return (
    <main className="page-shell mx-auto w-full max-w-[80rem] space-y-6 py-6">
      <header className="codequest-card p-5 sm:p-6">
        <p className="brand-eyebrow">Подборка</p>
        <h1 className="mt-2 text-2xl font-black text-slate-900">Полезные задания</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Курируемая лента материалов вне обязательной программы. Видна всем зарегистрированным
          пользователям после публикации; до публикации — только в этой админке.
        </p>
      </header>

      {loadErr ? (
        <div className="codequest-card border border-rose-200 p-4 text-rose-800">{loadErr}</div>
      ) : null}

      <section className="codequest-card p-5 sm:p-6">
        <p className="brand-eyebrow">{draft.id ? 'Редактирование' : 'Новая запись'}</p>
        <h2 className="mt-2 text-lg font-black text-slate-900">
          {draft.id ? `#${draft.id}` : 'Создать задание'}
        </h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-bold uppercase text-slate-500">Название</span>
            <input
              type="text"
              value={draft.title}
              onChange={e => setDraft({ ...draft, title: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2"
              maxLength={160}
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase text-slate-500">Slug (опц.)</span>
            <input
              type="text"
              value={draft.slug}
              onChange={e => setDraft({ ...draft, slug: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2"
              placeholder="auto-generated если пусто"
              maxLength={120}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-bold uppercase text-slate-500">Краткое описание</span>
          <textarea
            value={draft.summary}
            onChange={e => setDraft({ ...draft, summary: e.target.value })}
            className="mt-1 min-h-[4rem] w-full rounded-2xl border border-slate-200 px-4 py-2"
            maxLength={2000}
          />
        </label>

        <label className="mt-3 block">
          <span className="text-xs font-bold uppercase text-slate-500">Содержимое (markdown)</span>
          <textarea
            value={draft.body}
            onChange={e => setDraft({ ...draft, body: e.target.value })}
            className="mt-1 min-h-[8rem] w-full rounded-2xl border border-slate-200 px-4 py-2 font-mono text-sm"
            maxLength={20000}
          />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-bold uppercase text-slate-500">Внешняя ссылка</span>
            <input
              type="url"
              value={draft.external_url}
              onChange={e => setDraft({ ...draft, external_url: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2"
              placeholder="https://..."
              maxLength={500}
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase text-slate-500">Тема (короткий тег)</span>
            <input
              type="text"
              value={draft.topic}
              onChange={e => setDraft({ ...draft, topic: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2"
              maxLength={80}
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <span className="text-xs font-bold uppercase text-slate-500">Возрастные группы</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {AGE_GROUP_OPTIONS.map(group => (
                <button
                  type="button"
                  key={group}
                  onClick={() => toggleAgeGroup(group)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    draft.age_groups.includes(group)
                      ? 'bg-sky-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-bold uppercase text-slate-500">Сложность</span>
            <select
              value={draft.difficulty}
              onChange={e => setDraft({ ...draft, difficulty: e.target.value as UsefulDifficulty })}
              className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2"
            >
              {DIFFICULTY_OPTIONS.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.is_published}
            onChange={e => setDraft({ ...draft, is_published: e.target.checked })}
          />
          <span>Опубликовано (видно всем авторизованным)</span>
        </label>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={busy}
            className="brand-button-primary disabled:opacity-50"
          >
            {busy ? 'Сохраняем…' : draft.id ? 'Сохранить' : 'Создать'}
          </button>
          {draft.id ? (
            <button type="button" onClick={resetDraft} className="brand-button-secondary">
              Отмена
            </button>
          ) : null}
        </div>
      </section>

      <section className="codequest-card p-5 sm:p-6">
        <p className="brand-eyebrow">Список</p>
        <h2 className="mt-2 text-lg font-black text-slate-900">Все записи ({items.length})</h2>
        <ul className="mt-4 space-y-2">
          {items.map(task => (
            <li
              key={task.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">
                  #{task.id} · {task.title}
                  {task.is_published ? null : (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      черновик
                    </span>
                  )}
                </p>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {task.slug} · {task.difficulty} · {task.age_groups.join(', ') || 'без тегов'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(task)}
                  className="brand-button-secondary h-9 px-3 text-xs"
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(task.id)}
                  disabled={busy}
                  className="h-9 rounded-full border border-rose-200 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="text-sm text-slate-500">Пока ничего не создано.</li>
          ) : null}
        </ul>
      </section>
    </main>
  )
}
