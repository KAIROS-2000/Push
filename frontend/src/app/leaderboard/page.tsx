'use client'

import { useEffect, useState } from 'react'
import { SiteHeader } from '@/components/site-header'
import { api } from '@/lib/api'

interface Row {
  position: number
  username: string
  xp: number
  level: number
  age_group: string
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    api<{ leaderboard: Row[] }>('/leaderboard', undefined, true).then((data) => setRows(data.leaderboard)).catch(() => setRows([]))
  }, [])

  return (
    <main>
      <SiteHeader />
      <div className="page-shell mx-auto max-w-7xl">
        <section className="codequest-card overflow-hidden p-6 sm:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-amber-600">Топ игроков</p>
          <h1 className="page-title mt-2 text-slate-900">Рейтинг учеников</h1>
          <div className="mt-6 space-y-3 md:hidden">
            {rows.map((row) => (
              <article key={row.position} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">#{row.position}</p>
                    <h2 className="mt-1 text-lg font-black text-slate-900">{row.username}</h2>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-sky-700">{row.xp} XP</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
                  <span className="rounded-full bg-white px-3 py-1">Группа: {row.age_group}</span>
                  <span className="rounded-full bg-white px-3 py-1">Уровень: {row.level}</span>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-6 hidden overflow-x-auto md:block">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 text-sm text-slate-500">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Ник</th>
                  <th className="px-4 py-3">Возрастная группа</th>
                  <th className="px-4 py-3">Уровень</th>
                  <th className="px-4 py-3">XP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.position} className="border-b border-slate-100 text-sm">
                    <td className="px-4 py-4 font-bold text-slate-900">{row.position}</td>
                    <td className="px-4 py-4">{row.username}</td>
                    <td className="px-4 py-4">{row.age_group}</td>
                    <td className="px-4 py-4">{row.level}</td>
                    <td className="px-4 py-4 font-semibold text-sky-700">{row.xp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
