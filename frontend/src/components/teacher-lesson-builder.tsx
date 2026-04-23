'use client'

import { api } from '@/lib/api'
import type { ClassroomItem } from '@/types'
import { SharedLessonBuilder } from './shared-lesson-builder'

interface TeacherLessonBuilderProps {
  initialClasses: ClassroomItem[]
  initialClassId?: number | null
  sourceLessonId?: number | null
}

export function TeacherLessonBuilder({
  initialClasses,
  initialClassId = null,
  sourceLessonId = null,
}: TeacherLessonBuilderProps) {
  return (
    <SharedLessonBuilder
      mode='teacher'
      features={{
        drafts: true,
        sourcePrefill: true,
        publishToggle: false,
        insertPosition: false,
        quiz: true,
        help: true,
      }}
      targetConfig={{
        kind: 'classroom',
        classes: initialClasses,
        initialClassId,
        sourceLessonId,
        draftKey: 'progyx_teacher_lesson_builder_v2',
        createTargetHref: '/teacher',
      }}
      cancelHref='/teacher'
      submitLesson={async ({ target, lesson }) => {
        if (target.kind !== 'classroom') {
          throw new Error('Некорректная цель сохранения урока.')
        }

        const data = await api<{ lesson: { id: number; title: string; summary: string } }>(
          `/teacher/classes/${target.classroomId}/lessons`,
          {
            method: 'POST',
            body: JSON.stringify(lesson),
          },
          'required',
        )

        return {
          lesson: data.lesson,
          successMessage: 'Авторский урок создан. Его уже можно открыть и при необходимости позже назначить классу.',
        }
      }}
    />
  )
}
