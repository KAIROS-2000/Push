'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'

export default function ParentLandingPage() {
  const rootRef = useRef<HTMLElement | null>(null)
  useUserPageMotion(rootRef, [])

  return (
    <main ref={rootRef} className="brand-public-shell">
      <div className="brand-page-shell py-8 sm:py-12">
        <section className="grid gap-6 lg:grid-cols-[1fr_0.92fr]">
          <div className="codequest-card p-6 sm:p-8" data-motion-hero-copy>
            <p className="brand-eyebrow">Семейный кабинет</p>
            <h1 className="mt-3 text-4xl font-black leading-tight text-slate-900 sm:text-5xl">
              Подключайтесь к учёбе спокойно и без «технического жаргона».
            </h1>
            <p className="brand-lead mt-5">
              Зарегистрируйтесь как родитель, привяжите детей по короткому коду из их кабинета — и
              смотрите прогресс, практику и добрые подсказки, что хорошо получается и где мягко
              помочь.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="brand-chip brand-chip--soft">уроки и практика</span>
              <span className="brand-chip brand-chip--soft">достижения</span>
              <span className="brand-chip brand-chip--warm">поддержка без давления</span>
            </div>
          </div>

          <div className="codequest-card p-6 sm:p-8" data-motion-hero-visual>
            <p className="brand-eyebrow">Как начать</p>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7 text-slate-700">
              <li>
                <Link className="font-semibold text-sky-700" href="/auth/register">
                  Создайте аккаунт
                </Link>{' '}
                и выберите роль «Родитель».
              </li>
              <li>Попросите у ребёнка код из его кабинета (12 символов, действует ограниченное время).</li>
              <li>
                Войдите в{' '}
                <Link className="font-semibold text-sky-700" href="/parent/dashboard">
                  семейный кабинет
                </Link>{' '}
                и введите код.
              </li>
            </ol>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link href="/parent/dashboard" className="brand-button-primary text-center">
                Перейти в кабинет
              </Link>
              <Link href="/auth/login" className="brand-button-ghost text-center">
                Вход
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
