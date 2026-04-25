import { LessonPlayer } from '@/components/lesson-player'
import { fetchLessonPlayerInitial } from '@/lib/server-api'
import { notFound } from 'next/navigation'

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params
  if (!/^\d+$/.test(lessonId)) {
    notFound()
  }
  const initial = await fetchLessonPlayerInitial(lessonId)
  if (initial === 'not_found') {
    notFound()
  }
  return (
    <main className="brand-app-shell">
      <div className="page-shell mx-auto w-full max-w-[96rem]">
        <LessonPlayer lessonId={Number(lessonId)} initialData={initial} />
      </div>
    </main>
  )
}
