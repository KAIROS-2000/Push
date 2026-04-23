import { serverApi } from '@/lib/server-api'
import { LessonPlayer, type LessonPlayerPayload } from '@/components/lesson-player'

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params
  const initialData = await serverApi<LessonPlayerPayload>(`/lessons/${lessonId}`).catch(() => null)
  return (
    <main className="brand-app-shell">
      <div className="page-shell mx-auto w-full max-w-[96rem]">
        <LessonPlayer lessonId={Number(lessonId)} initialData={initialData} />
      </div>
    </main>
  )
}
