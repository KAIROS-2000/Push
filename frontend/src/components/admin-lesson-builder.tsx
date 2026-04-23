'use client'

import { api } from '@/lib/api'
import type { ModuleItem } from '@/types'
import { SharedLessonBuilder } from './shared-lesson-builder'

interface AdminLessonBuilderProps {
  modules: ModuleItem[]
  onReload?: () => Promise<void> | void
}

interface CreateLessonResponse {
  lesson: {
    id: number
    title: string
    summary: string
  }
  roadmap_visible: boolean
  module: ModuleItem
}

export function AdminLessonBuilder({ modules, onReload }: AdminLessonBuilderProps) {
  return (
    <SharedLessonBuilder
      mode='admin'
      features={{
        drafts: false,
        sourcePrefill: false,
        publishToggle: true,
        insertPosition: true,
        quiz: true,
        help: false,
      }}
      targetConfig={{
        kind: 'module',
        modules,
      }}
      submitLesson={async ({ target, lesson }) => {
        if (target.kind !== 'module') {
          throw new Error('Некорректная цель сохранения урока.')
        }

        const data = await api<CreateLessonResponse>(
          `/admin/modules/${target.moduleId}/lessons`,
          {
            method: 'POST',
            body: JSON.stringify({
              title: lesson.title,
              summary: lesson.summary,
              theory_text: lesson.theory_text,
              key_points: lesson.key_points,
              interactive_steps: lesson.interactive_steps,
              duration_minutes: lesson.duration_minutes,
              passing_score: lesson.passing_score,
              insert_position: target.insertPosition,
              publish_module_if_needed: target.publishModuleIfNeeded,
              task: {
                enabled: lesson.practice_enabled,
                task_type: lesson.task_type,
                title: lesson.task_title,
                prompt: lesson.task_prompt,
                evaluation_mode: lesson.practice_enabled ? lesson.evaluation_mode : 'manual',
                language: lesson.task_type === 'code' ? lesson.programming_language : null,
                keywords: lesson.evaluation_mode === 'keywords' ? lesson.answer_keywords : '',
                starter_code: lesson.task_type === 'code' ? lesson.starter_code : '',
                hints: lesson.task_hints,
                tests: lesson.task_type === 'code' ? lesson.judge_tests : [],
                time_limit_ms: lesson.task_type === 'code' ? lesson.time_limit_ms : null,
                memory_limit_mb: lesson.task_type === 'code' ? lesson.memory_limit_mb : null,
              },
              quiz: lesson.quiz,
            }),
          },
          'required',
        )

        return {
          lesson: data.lesson,
          successMessage: data.roadmap_visible
            ? 'Урок создан и уже попадёт в раздел уроков выбранной возрастной группы.'
            : 'Урок создан, но модуль пока скрыт из раздела уроков. Включите публикацию модуля.',
          nextInsertPosition: String((data.module.lessons?.length || 0) + 1),
        }
      }}
      onCreated={async () => {
        await onReload?.()
      }}
    />
  )
}
