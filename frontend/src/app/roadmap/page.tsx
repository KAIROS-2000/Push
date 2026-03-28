'use client'

import { useEffect, useState } from 'react'
import { SiteHeader } from '@/components/site-header'
import { RoadmapPunsons } from '@/components/roadmap-punsons'
import { api } from '@/lib/api'
import { ModuleItem, UserItem } from '@/types'

const GROUP_LABELS: Record<string, string> = {
  junior: '7-10',
  middle: '11-13',
  senior: '14-15',
}

function normalizeGroup(value: string | null | undefined) {
  return value && value in GROUP_LABELS ? value : 'middle'
}

export default function RoadmapPage() {
  const [group, setGroup] = useState<string | null>(null)
  const [modules, setModules] = useState<ModuleItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    api<{ user: UserItem }>('/auth/me', undefined, true)
      .then((data) => {
        if (!cancelled) {
          setGroup((currentGroup) => currentGroup ?? normalizeGroup(data.user.age_group))
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось определить возрастную группу')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!group) return

    let cancelled = false
    setLoading(true)
    setError('')

    api<{ modules: ModuleItem[] }>(`/modules?age_group=${group}`, undefined, true)
      .then((data) => {
        if (!cancelled) {
          setModules(data.modules)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить roadmap')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [group])

  return (
    <main>
      <SiteHeader />
      <div className="page-shell mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-sky-600">Карта модулей</p>
            <h1 className="mt-2 break-words text-3xl font-black leading-tight text-slate-900 sm:text-4xl">Roadmap обучения</h1>
          </div>
          <div className="flex w-full flex-wrap gap-3 sm:w-auto">
            {[
              ['junior', '7–10'],
              ['middle', '11–13'],
              ['senior', '14–15'],
            ].map(([value, label]) => (
              <button key={value} onClick={() => setGroup(value)} className={`rounded-full px-4 py-2 text-sm font-semibold ${group === value ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <div className="codequest-card p-6 text-rose-700">{error}</div>
        ) : loading || !group ? (
          <div className="codequest-card p-6">Загружаем roadmap...</div>
        ) : (
          <RoadmapPunsons title={`Возрастная группа ${GROUP_LABELS[group] || group}`} modules={modules} />
        )}
      </div>
    </main>
  )
}
