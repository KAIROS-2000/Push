'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

export function NotFoundActions() {
  const router = useRouter()

  return (
    <div className='mt-10 flex w-full max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center sm:gap-4'>
      <Link href='/' className='brand-button-primary min-h-[3.15rem] text-center sm:min-w-[12rem]'>
        На главную
      </Link>
      <button
        type='button'
        className='brand-button-secondary min-h-[3.15rem] sm:min-w-[12rem]'
        onClick={() => router.back()}
      >
        Назад
      </button>
    </div>
  )
}
