import Link from 'next/link'

import { NotFoundActions } from '@/components/not-found-actions'

/** Показывается внутри shell приложения, когда урок не найден (API 404). */
export function LessonNotFoundPanel() {
  return (
    <div className='page-shell mx-auto flex w-full max-w-3xl flex-col items-center py-8 sm:py-12 md:py-16'>
      <div className='relative w-full text-center'>
        <div
          aria-hidden
          className='pointer-events-none absolute -top-8 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(11,103,255,0.18),transparent_68%)] blur-2xl sm:h-64 sm:w-64 dark:bg-[radial-gradient(circle,rgba(110,168,255,0.15),transparent_68%)]'
        />
        <div
          aria-hidden
          className='pointer-events-none absolute -bottom-4 right-0 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(255,201,65,0.14),transparent_72%)] blur-2xl sm:right-6 dark:bg-[radial-gradient(circle,rgba(255,213,103,0.1),transparent_72%)]'
        />

        <div className='codequest-card relative overflow-hidden px-5 py-8 sm:px-8 sm:py-10 md:px-12 md:py-12'>
          <div
            aria-hidden
            className='absolute inset-0 bg-[linear-gradient(135deg,rgba(11,103,255,0.04)_0%,transparent_45%,rgba(18,155,87,0.04)_100%)] dark:bg-[linear-gradient(135deg,rgba(110,168,255,0.08)_0%,transparent_48%,rgba(59,198,120,0.06)_100%)]'
          />

          <div className='relative z-[1]'>
            <p className='brand-eyebrow justify-center'>Урок</p>
            <p
              className='mt-3 bg-gradient-to-br from-sky-600 via-sky-500 to-emerald-500 bg-clip-text text-[clamp(3.25rem,14vw,6.5rem)] font-black leading-[0.92] tracking-[-0.06em] text-transparent dark:from-sky-400 dark:via-sky-300 dark:to-emerald-400'
              style={{ fontFamily: 'var(--progyx-font-heading), system-ui, sans-serif' }}
            >
              404
            </p>
            <h1 className='home-scenes__title mx-auto mt-4 max-w-xl text-balance text-slate-900 sm:mt-5'>
              Такого урока нет
            </h1>
            <p className='brand-lead mx-auto mt-3 max-w-lg text-balance sm:mt-4'>
              Возможно, ссылка устарела или урок перенесён. Загляни в{' '}
              <Link
                href='/roadmap'
                className='font-semibold text-sky-600 underline decoration-sky-400/50 underline-offset-2 transition hover:text-sky-700 hover:decoration-sky-500 dark:text-sky-400 dark:decoration-sky-500/40 dark:hover:text-sky-300'
              >
                маршрут
              </Link>{' '}
              или на главную.
            </p>
            <NotFoundActions />
          </div>
        </div>
      </div>
    </div>
  )
}
