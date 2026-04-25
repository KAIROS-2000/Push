import type { Metadata } from 'next'

import { LessonNotFoundPanel } from '@/components/lesson-not-found-panel'

export const metadata: Metadata = {
  title: 'Урок не найден',
  description: 'Запрошенный урок не существует или был удалён.',
}

export default function LessonNotFound() {
  return (
    <main className='brand-app-shell'>
      <LessonNotFoundPanel />
    </main>
  )
}
