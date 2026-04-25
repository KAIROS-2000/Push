'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SiteFooter } from '@/components/site-footer'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'

export default function ParentEntryPage() {
  const rootRef = useRef<HTMLElement | null>(null)
  const [code, setCode] = useState('')
  const router = useRouter()

  useUserPageMotion(rootRef, [code])

  return (
    <main ref={rootRef} className="brand-public-shell">
      <div className="brand-page-shell py-8 sm:py-12">
        <section className="grid gap-6 lg:grid-cols-[1fr_0.92fr]">
          <div className="codequest-card p-6 sm:p-8" data-motion-hero-copy>
            <p className="brand-eyebrow">Родительский доступ</p>
            <h1 className="mt-3 text-4xl font-black leading-tight text-slate-900 sm:text-5xl">
              Спокойно увидеть, как у ребёнка идут уроки и модули.
            </h1>
            <p className="brand-lead mt-5">
              Введите семейный код, который вы получили от ученика. Родительский кабинет показывает прогресс, активность, последние достижения и статус заданий без лишней сложности.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="brand-chip brand-chip--soft">уроки и модули</span>
              <span className="brand-chip brand-chip--soft">последние сдачи</span>
              <span className="brand-chip brand-chip--warm">контроль + доверие</span>
            </div>
          </div>

          <div className="codequest-card p-6 sm:p-8" data-motion-hero-visual>
            <p className="brand-eyebrow">Открыть кабинет</p>
            <div className="mt-5 flex flex-col gap-3">
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                placeholder="Например, PAR-AB12CD34"
              />
              <button
                disabled={!code}
                onClick={() => router.push(`/parent/${code}`)}
                className="brand-button-primary w-full disabled:opacity-50"
              >
                Открыть родительский кабинет
              </button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2" data-motion-stagger>
              <div className="rounded-[24px] bg-slate-50 p-4" data-motion-item data-motion-hover>
                <p className="text-sm font-bold text-slate-900">Что увидит родитель</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">Прогресс по модулям, активность за неделю, достижения и последние отправки.</p>
              </div>
              <div className="rounded-[24px] bg-slate-50 p-4" data-motion-item data-motion-hover>
                <p className="text-sm font-bold text-slate-900">Почему это удобно</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">Никаких сложных настроек: код открывает только связанный семейный кабинет.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  )
}
