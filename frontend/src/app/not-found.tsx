import type { Metadata } from 'next'
import Link from 'next/link'

import { NotFoundActions } from '@/components/not-found-actions'

export const metadata: Metadata = {
  title: 'Страница не найдена',
  description: 'Запрошенный адрес не существует или был перемещён.',
}

export default function NotFound() {
  return (
    <main className='brand-public-shell grid-bg'>
      <div className='page-shell flex min-h-[min(100dvh,100%)] flex-col items-center justify-center py-12'>
        <div className='relative w-full max-w-3xl text-center'>
          <div
            aria-hidden
            className='pointer-events-none absolute -top-10 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(11,103,255,0.2)_0%,transparent_68%)] blur-2xl sm:h-80 sm:w-80 dark:bg-[radial-gradient(circle,rgba(110,168,255,0.18)_0%,transparent_68%)]'
          />
          <div
            aria-hidden
            className='pointer-events-none absolute -bottom-6 right-0 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(255,201,65,0.16)_0%,transparent_70%)] blur-2xl sm:right-8 dark:bg-[radial-gradient(circle,rgba(255,213,103,0.12)_0%,transparent_70%)]'
          />

          <div className='codequest-card relative overflow-hidden px-6 py-10 sm:px-10 sm:py-12 md:px-12 md:py-14'>
            <div
              aria-hidden
              className='absolute inset-0 bg-[linear-gradient(135deg,rgba(11,103,255,0.04)_0%,transparent_45%,rgba(18,155,87,0.04)_100%)] dark:bg-[linear-gradient(135deg,rgba(110,168,255,0.08)_0%,transparent_48%,rgba(59,198,120,0.06)_100%)]'
            />

            <div className='relative z-[1]'>
              <p className='brand-eyebrow justify-center'>Страница не найдена</p>

              <p
                className='mt-3 bg-gradient-to-br from-sky-600 via-sky-500 to-emerald-500 bg-clip-text text-[clamp(4.5rem,16vw,8.5rem)] font-black leading-[0.92] tracking-[-0.06em] text-transparent dark:from-sky-400 dark:via-sky-300 dark:to-emerald-400'
                style={{ fontFamily: 'var(--progyx-font-heading), system-ui, sans-serif' }}
              >
                404
              </p>

              <h1 className='home-scenes__title mx-auto mt-5 max-w-xl text-balance text-slate-900'>
                Кажется, эта ветка маршрута ведёт в пустоту
              </h1>

              <p className='brand-lead mx-auto mt-4 max-w-lg text-balance'>
                Мы не нашли страницу по этому адресу. Проверьте ссылку или вернитесь на{' '}
                <Link
                  href='/'
                  className='font-semibold text-sky-600 underline decoration-sky-400/50 underline-offset-2 transition hover:text-sky-700 hover:decoration-sky-500 dark:text-sky-400 dark:decoration-sky-500/40 dark:hover:text-sky-300'
                >
                  главную
                </Link>
                — там всё под контролем.
              </p>

              <NotFoundActions />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
