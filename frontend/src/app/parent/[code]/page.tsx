'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ParentDashboard } from '@/components/parent-dashboard'
import { api } from '@/lib/api'
import { ParentAccessData } from '@/types'

export default function ParentCodePage() {
  const params = useParams<{ code: string }>()
  const [data, setData] = useState<ParentAccessData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<ParentAccessData>(`/parent/access/${params.code}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось открыть кабинет родителя'))
  }, [params.code])

  return (
    <main className="brand-parent-shell">
      <div className="page-shell mx-auto w-full max-w-[96rem]">
        {error ? <div className="codequest-card p-6 text-rose-700">{error}</div> : data ? <ParentDashboard data={data} /> : <div className="codequest-card p-6">Загружаем кабинет родителя…</div>}
      </div>
    </main>
  )
}
