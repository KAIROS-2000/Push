'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { api } from '@/lib/api'
import { queueMascotScenario } from '@/lib/mascot'
import { getAccessTokenRole } from '@/lib/storage'
import { LessonGigachatDrawer } from '@/components/lesson-gigachat-drawer'
import { JudgeReport, LessonDetail, ProgressItem, QuizItem, QuizQuestion } from '@/types'

function moveItem(list: string[], from: number, to: number) {
  const next = [...list]
  const [picked] = next.splice(from, 1)
  next.splice(to, 0, picked)
  return next
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number')
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, item]) => {
    if (typeof item === 'string') {
      acc[key] = item
    }
    return acc
  }, {})
}

function isQuestionAnswered(question: QuizQuestion, answer: unknown) {
  if (question.type === 'single') return typeof answer === 'number'
  if (question.type === 'multiple') return toNumberArray(answer).length > 0
  if (question.type === 'order') return toStringArray(answer).length > 0
  if (question.type === 'match') return Object.keys(toStringRecord(answer)).length > 0
  if (question.type === 'text') return typeof answer === 'string' && answer.trim().length > 0
  return false
}

function ageGroupSupportsCodePractice(ageGroup?: string | null) {
  return ageGroup !== 'junior'
}

function lessonStatusLabel(status?: ProgressItem['status']) {
  if (status === 'completed') return 'Завершён'
  if (status === 'pending_review') return 'Ожидает проверки'
  if (status === 'needs_revision') return 'Нужно исправить'
  if (status === 'in_progress') return 'В процессе'
  return 'Не начат'
}

function OrderQuestion({ question, value, onChange }: { question: QuizQuestion; value: string[]; onChange: (next: string[]) => void }) {
  const items = value.length ? value : [...(question.items || [])]

  useEffect(() => {
    if (!value.length && question.items?.length) {
      onChange([...(question.items || [])])
    }
  }, [question.items, value.length, onChange])

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Шаг {index + 1}</p>
            <p className="font-semibold text-slate-900">{item}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700" disabled={index === 0} onClick={() => onChange(moveItem(items, index, index - 1))}>↑</button>
            <button type="button" className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700" disabled={index === items.length - 1} onClick={() => onChange(moveItem(items, index, index + 1))}>↓</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function MatchQuestion({ question, value, onChange }: { question: QuizQuestion; value: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const left = question.left || []
  const right = question.right || []

  return (
    <div className="grid gap-3">
      {left.map((item) => (
        <div key={item} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_220px] md:items-center">
          <p className="font-semibold text-slate-900">{item}</p>
          <select
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            value={value[item] || ''}
            onChange={(e) => onChange({ ...value, [item]: e.target.value })}
          >
            <option value="">Выбери пару</option>
            {right.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}

function QuestionCard({ question, value, onChange, number }: { question: QuizQuestion; value: unknown; onChange: (next: unknown) => void; number: number }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="break-words text-base font-black text-slate-900 sm:text-lg">{number}. {question.prompt}</p>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-700">{question.type}</span>
      </div>

      <div className="mt-4">
        {question.type === 'single' && (
          <div className="grid gap-3">
            {question.options?.map((option, index) => (
              <button
                key={option}
                type="button"
                onClick={() => onChange(index)}
                className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold ${value === index ? 'border-sky-600 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-700'}`}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {question.type === 'multiple' && (
          <div className="grid gap-3">
            {question.options?.map((option, index) => {
              const current = toNumberArray(value)
              const checked = current.includes(index)
              return (
                <label key={option} className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 ${checked ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked ? [...current, index] : current.filter((item: number) => item !== index)
                      onChange(next)
                    }}
                  />
                  <span className="text-sm font-semibold text-slate-800">{option}</span>
                </label>
              )
            })}
          </div>
        )}

        {question.type === 'order' && (
          <OrderQuestion question={question} value={toStringArray(value)} onChange={onChange} />
        )}

        {question.type === 'match' && (
          <MatchQuestion question={question} value={toStringRecord(value)} onChange={onChange} />
        )}

        {question.type === 'text' && (
          <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
    </div>
  )
}

export function LessonPlayer({ lessonId }: { lessonId: number }) {
  const router = useRouter()
  const currentUserRole = useMemo(() => getAccessTokenRole(), [])
  const [lesson, setLesson] = useState<LessonDetail | null>(null)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState('')
  const [quizAnswers, setQuizAnswers] = useState<Record<string, unknown>>({})
  const [result, setResult] = useState('')
  const [resultTone, setResultTone] = useState<'neutral' | 'success' | 'warning'>('neutral')
  const [loadingTask, setLoadingTask] = useState(false)
  const [loadingQuiz, setLoadingQuiz] = useState(false)
  const [shownHints, setShownHints] = useState(0)
  const [theoryMarked, setTheoryMarked] = useState(false)
  const [interactiveMarked, setInteractiveMarked] = useState(false)
  const [taskPassed, setTaskPassed] = useState(false)
  const [quizPassed, setQuizPassed] = useState(false)
  const [savingCompletion, setSavingCompletion] = useState(false)
  const [progress, setProgress] = useState<ProgressItem | null>(null)
  const [judgeReport, setJudgeReport] = useState<JudgeReport | null>(null)
  const isTeacherLesson = Boolean(lesson?.is_custom)
  const bypassCompletionApi = currentUserRole !== null && currentUserRole !== 'student'

  useEffect(() => {
    api<{ lesson: LessonDetail; progress: ProgressItem }>(`/lessons/${lessonId}`, undefined, true)
      .then((data) => {
        setLesson({
          ...data.lesson,
          module: {
            ...data.lesson.module,
            lessons: Array.isArray(data.lesson.module?.lessons) ? data.lesson.module.lessons : [],
          },
        })
        setProgress(data.progress)
        setAnswer('')
        setQuizAnswers({})
        setShownHints(0)
        const isFinished = data.progress.status === 'completed' || data.progress.status === 'pending_review'
        setTheoryMarked(isFinished)
        setInteractiveMarked(isFinished)
        setTaskPassed(isFinished)
        setQuizPassed(isFinished)
        setResult('')
        setResultTone('neutral')
        setJudgeReport(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить урок'))
  }, [lessonId])

  const quiz = useMemo<QuizItem | null>(() => lesson?.quizzes?.[0] || null, [lesson])
  const task = lesson?.tasks?.[0]
  const taskValidation = task?.validation
  const taskEvaluationMode = taskValidation?.evaluation_mode || 'manual'
  const taskNeedsTeacherReview = Boolean(isTeacherLesson && taskEvaluationMode === 'manual')
  const lessonNeedsTeacherReview = Boolean(isTeacherLesson && (!task || taskNeedsTeacherReview))
  const teacherReviewFlow = lessonNeedsTeacherReview && !bypassCompletionApi
  const supportsCodePractice = ageGroupSupportsCodePractice(lesson?.module.age_group)
  const usesCodeEditor = Boolean(supportsCodePractice && (task?.task_type === 'code' || taskValidation?.runner === 'stdin_stdout'))
  const editorLanguage = taskValidation?.language === 'javascript'
    ? 'javascript'
    : lesson?.module.age_group === 'senior'
      ? 'javascript'
      : 'python'
  const completedHints = task ? Math.min(shownHints, task.hints.length) : 0
  const answeredQuizCount = useMemo(() => {
    if (!quiz) return 0
    return quiz.questions.filter((question) => isQuestionAnswered(question, quizAnswers[question.id])).length
  }, [quiz, quizAnswers])
  const theoryHighlights = useMemo(() => {
    if (!lesson) return []

    const items = lesson.theory_blocks.flatMap((block) => {
      const entries: string[] = []
      if (block.title?.trim()) {
        entries.push(block.title.trim())
      }
      if (block.items?.length) {
        entries.push(...block.items.map((item) => item.trim()).filter(Boolean))
      }
      return entries
    })

    return Array.from(new Set(items)).slice(0, 4)
  }, [lesson])
  const interactiveHighlights = useMemo(() => {
    if (!lesson) return []

    return lesson.interactive_steps
      .map((step) => step.title?.trim() || step.text?.trim() || '')
      .filter(Boolean)
      .slice(0, 3)
  }, [lesson])
  const moduleLessons = useMemo(() => {
    if (!lesson) return []

    return [...(Array.isArray(lesson.module.lessons) ? lesson.module.lessons : [])].sort((left, right) => {
      if (left.order_index !== right.order_index) return left.order_index - right.order_index
      return left.id - right.id
    })
  }, [lesson])
  const currentLessonIndex = moduleLessons.findIndex((item) => item.id === lesson?.id)
  const nextLesson = currentLessonIndex >= 0 ? moduleLessons[currentLessonIndex + 1] || null : null

  const learningSteps = useMemo(() => {
    return [
      { id: 'theory', label: 'Теория', completed: theoryMarked },
      { id: 'interactive', label: 'Разбор примера', completed: interactiveMarked || (lesson?.interactive_steps.length || 0) === 0 },
      { id: 'practice', label: 'Практика', completed: task ? taskPassed : true },
      { id: 'quiz', label: 'Итоговый квиз', completed: quiz ? quizPassed : true },
    ]
  }, [interactiveMarked, lesson?.interactive_steps.length, quiz, quizPassed, task, taskPassed, theoryMarked])

  const completedStepsCount = learningSteps.filter((step) => step.completed).length
  const progressPercent = Math.round((completedStepsCount / learningSteps.length) * 100)
  const progressStatusLabel = lessonStatusLabel(progress?.status)
  const lessonPassingScore = lesson?.passing_score ?? 100
  const moduleIsCustom = Boolean(lesson?.module?.is_custom_classroom_module)
  const completionReady = progressPercent >= 100
  const currentLessonPassesThreshold = progress?.status === 'completed' || progressPercent >= lessonPassingScore
  const nextLessonRequiresUnlock = !moduleIsCustom
  const canOpenNextLesson = Boolean(nextLesson) && !teacherReviewFlow && (!nextLessonRequiresUnlock || currentLessonPassesThreshold)
  const completionTitle = teacherReviewFlow
    ? completionReady
      ? 'Урок готов к отправке'
      : 'Сохрани прогресс и вернись позже'
    : completionReady
      ? 'Урок завершен!'
      : 'Сохрани прогресс и продолжай'
  const completionDescription = teacherReviewFlow
    ? 'Мы сохраним текущий прогресс и отправим урок учителю на проверку. После проверки откроется следующий шаг.'
    : bypassCompletionApi
      ? nextLesson
        ? 'Можно вернуться в roadmap или сразу открыть следующий урок модуля.'
        : 'Можно вернуться в roadmap и выбрать следующий шаг.'
      : nextLesson
        ? 'Сохраним результат урока и дадим выбор: вернуться в roadmap или сразу перейти к следующему уроку модуля.'
        : 'Сохраним результат урока и поможем вернуться в roadmap, чтобы выбрать следующий шаг.'
  const completionBadgeLabel = completionReady ? '100%' : `${progressPercent}%`
  const nextActionTitle = savingCompletion
    ? 'Сохраняем...'
    : teacherReviewFlow
      ? 'Следующий шаг после проверки'
      : !nextLesson
        ? 'Уроков дальше пока нет'
        : !canOpenNextLesson
          ? 'Следующий урок недоступен'
          : 'Следующий урок'
  const nextActionHint = teacherReviewFlow
    ? 'Откроется после проверки учителем'
    : !nextLesson
      ? 'Можно вернуться в roadmap и выбрать другой модуль'
      : !canOpenNextLesson
        ? `Сначала набери минимум ${lessonPassingScore}% прогресса в текущем уроке`
        : nextLesson.title

  function jumpTo(id: string) {
    if (typeof document === 'undefined') return
    const element = document.getElementById(id)
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function submitTask() {
    if (!task) return
    setLoadingTask(true)
    try {
      const data = await api<{
        feedback: string
        score: number
        passed: boolean
        xp_awarded: number
        progress: ProgressItem
        judge_report?: JudgeReport | null
        requires_teacher_review?: boolean
      }>(`/tasks/${task.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      }, true)
      const requiresTeacherReview = Boolean(data.requires_teacher_review)
      setJudgeReport(data.judge_report || null)
      setResult(requiresTeacherReview ? data.feedback : `${data.feedback} Результат: ${data.score}%. ${data.xp_awarded ? `+${data.xp_awarded} XP.` : ''}`)
      setResultTone(data.passed ? 'success' : 'warning')
      setTaskPassed(data.passed)
      setProgress(data.progress)
    } catch (e) {
      setJudgeReport(null)
      setResult(e instanceof Error ? e.message : 'Не удалось отправить решение.')
      setResultTone('warning')
    } finally {
      setLoadingTask(false)
    }
  }

  async function submitQuiz() {
    if (!quiz) return
    setLoadingQuiz(true)
    try {
      const data = await api<{ passed: boolean; score: number; correct_answers: number; total_questions: number; xp_awarded: number; progress: ProgressItem }>(`/quizzes/${quiz.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: quizAnswers }),
      }, true)
      setResult(`Тест: ${data.correct_answers}/${data.total_questions}, ${data.score}%. ${data.passed ? 'Урок завершён!' : 'Можно улучшить результат.'} ${data.xp_awarded ? `+${data.xp_awarded} XP.` : ''}`)
      setResultTone(data.passed ? 'success' : 'warning')
      setQuizPassed(data.passed)
      setProgress(data.progress)
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Не удалось отправить квиз.')
      setResultTone('warning')
    } finally {
      setLoadingQuiz(false)
    }
  }

  async function finishLesson(redirectTo?: string) {
    if (bypassCompletionApi) {
      router.push(redirectTo || '/roadmap')
      return
    }
    setSavingCompletion(true)
    try {
      const data = await api<{ message: string; progress: ProgressItem; redirect_url: string; first_completed_lesson?: boolean }>(`/lessons/${lessonId}/complete`, {
        method: 'PATCH',
        body: JSON.stringify({ completion_percent: progressPercent, answer }),
      }, true)
      setProgress(data.progress)
      setResult(data.message)
      setResultTone(data.progress.status === 'completed' || data.progress.status === 'pending_review' ? 'success' : 'neutral')
      if (data.first_completed_lesson) {
        queueMascotScenario('first_lesson_complete')
      }
      router.push(redirectTo || data.redirect_url || '/profile')
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Не удалось завершить урок.')
      setResultTone('warning')
    } finally {
      setSavingCompletion(false)
    }
  }

  if (error) return <div className="codequest-card p-6 text-rose-700">{error}</div>
  if (!lesson) return <div className="codequest-card p-6">Загружаем урок…</div>

  const resultClass = resultTone === 'success'
    ? 'bg-emerald-50 text-emerald-700'
    : resultTone === 'warning'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-700'

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
        <section className="codequest-card p-5">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Урок</p>
          <h1 className="mt-2 break-words text-xl font-black text-slate-900 sm:text-2xl">{lesson.title}</h1>
          <p className="mt-3 break-words text-sm leading-7 text-slate-600">{lesson.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">{lesson.module.title}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{lesson.duration_minutes} мин</span>
            <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">Порог {lesson.passing_score}%</span>
          </div>
        </section>

        <section className="codequest-card p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Прогресс</p>
            <span className="text-sm font-semibold text-slate-700">{progressPercent}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-sky-600 transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="mt-4 space-y-2">
            {learningSteps.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={() => jumpTo(step.id)}
                className={`flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm font-semibold ${
                  step.completed ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-700'
                }`}
              >
                <span>{step.label}</span>
                <span>{step.completed ? 'Готово' : 'В работе'}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
            Статус урока: <span className="font-semibold text-slate-900">{progressStatusLabel}</span>
          </div>
        </section>

        </aside>

        <section className="space-y-6">
        <div className="scrollbar-hidden sticky top-20 z-20 flex gap-2 overflow-x-auto rounded-[20px] border border-white/70 bg-white/90 p-3 backdrop-blur-xl">
          {[
            ['theory', 'Теория'],
            ['interactive', 'Разбор'],
            ['practice', 'Практика'],
            ['quiz', 'Квиз'],
          ].map(([id, label]) => (
            <button key={id} type="button" onClick={() => jumpTo(id)} className="shrink-0 rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-900 hover:text-white sm:text-sm">
              {label}
            </button>
          ))}
        </div>

        <article id="theory" className="codequest-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Теория</p>
              <h2 className="mt-2 break-words text-2xl font-black text-slate-900 sm:text-3xl">{lesson.title}</h2>
            </div>
            <button
              type="button"
              onClick={() => setTheoryMarked((value) => !value)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${theoryMarked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}
            >
              {theoryMarked ? 'Теория изучена' : 'Отметить как изучено'}
            </button>
          </div>
          <div className="mt-6 space-y-4">
            {lesson.theory_blocks.map((block, index) => (
              <div key={index} className="rounded-[22px] bg-slate-50 p-5">
                <h3 className="text-lg font-bold text-slate-900">{block.title}</h3>
                {block.text && <p className="mt-2 text-sm leading-7 text-slate-600">{block.text}</p>}
                {block.items && (
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    {block.items.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </article>

        <article id="interactive" className="codequest-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Разбор примера</p>
            <button
              type="button"
              onClick={() => setInteractiveMarked((value) => !value)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${interactiveMarked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}
            >
              {interactiveMarked ? 'Разбор отмечен' : 'Отметить как изучено'}
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            {lesson.interactive_steps.length > 0 ? (
              lesson.interactive_steps.map((step, index) => (
                <div key={step.title} className="rounded-[22px] border border-slate-200 bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Шаг {index + 1}</p>
                  <h3 className="mt-1 font-bold text-slate-900">{step.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">{step.text}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">Для этого урока нет отдельного интерактивного разбора.</p>
            )}
          </div>
        </article>

        {task ? (
          <article id="practice" className="codequest-card p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Практика</p>
                    <h2 className="mt-2 break-words text-xl font-black text-slate-900 sm:text-2xl">{task.title}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {task.validation.runner === 'stdin_stdout' && (
                      <>
                        <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                          {task.validation.language === 'javascript' ? 'JavaScript' : 'Python'}
                        </span>
                        <span className="rounded-full bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700">
                          Автотесты {task.validation.tests_count || 0}
                        </span>
                      </>
                    )}
                    {!taskNeedsTeacherReview && !isTeacherLesson && task.xp_reward > 0 && (
                      <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">Награда {task.xp_reward} XP</span>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-600">{task.prompt}</p>
                {usesCodeEditor ? (
                  <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
                    <Editor
                      height="360px"
                      defaultLanguage={editorLanguage}
                      value={answer}
                      onChange={(value) => setAnswer(value || '')}
                      theme="vs-light"
                    />
                  </div>
                ) : (
                  <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3">
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Напиши ответ в свободной форме."
                      className="h-[340px] w-full resize-y rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    />
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button disabled={loadingTask} onClick={submitTask} className="w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
                    {loadingTask ? 'Проверяем…' : taskNeedsTeacherReview ? 'Сохранить ответ' : 'Проверить задачу'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnswer('')}
                    className="w-full rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 sm:w-auto"
                  >
                    {usesCodeEditor ? 'Очистить код' : 'Очистить ответ'}
                  </button>
                  <button
                    type="button"
                    disabled={completedHints >= task.hints.length}
                    onClick={() => setShownHints((value) => value + 1)}
                    className="w-full rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-700 disabled:opacity-50 sm:w-auto"
                  >
                    {completedHints >= task.hints.length ? 'Подсказки закончились' : 'Показать подсказку'}
                  </button>
                </div>
                {judgeReport && (
                  <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Автопроверка</p>
                        <p className="mt-1 text-lg font-black text-slate-900">{judgeReport.feedback}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-sm font-semibold">
                        <span className="rounded-full bg-white px-3 py-1 text-slate-700">{judgeReport.score}%</span>
                        {typeof judgeReport.tests_total === 'number' && (
                          <span className="rounded-full bg-white px-3 py-1 text-slate-700">
                            {judgeReport.tests_passed || 0}/{judgeReport.tests_total} тестов
                          </span>
                        )}
                      </div>
                    </div>
                    {judgeReport.mode === 'keywords' && (
                      <div className="mt-3 space-y-2 text-sm text-slate-600">
                        <p>Совпало ориентиров: {judgeReport.tests_passed || 0} из {judgeReport.tests_total || 0}.</p>
                        {(judgeReport.missing_keywords || []).length > 0 && (
                          <p>Не найдены: {(judgeReport.missing_keywords || []).join(', ')}.</p>
                        )}
                      </div>
                    )}
                    {judgeReport.mode === 'stdin_stdout' && (
                      <div className="mt-4 space-y-3">
                        {(judgeReport.results || []).map((item) => (
                          <div key={`${item.label}-${item.input}`} className="rounded-2xl bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="font-semibold text-slate-900">{item.label}</p>
                              <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {item.passed ? 'OK' : 'Ошибка'}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-3 text-xs leading-6 text-slate-600 md:grid-cols-2">
                              <div>
                                <p className="font-bold uppercase tracking-[0.14em] text-slate-400">Вход</p>
                                <pre className="mt-1 overflow-auto rounded-2xl bg-slate-950 p-3 text-emerald-200">{item.input || '(пусто)'}</pre>
                              </div>
                              <div>
                                <p className="font-bold uppercase tracking-[0.14em] text-slate-400">Ожидалось</p>
                                <pre className="mt-1 overflow-auto rounded-2xl bg-slate-950 p-3 text-emerald-200">{item.expected || '(пусто)'}</pre>
                              </div>
                            </div>
                            {!item.passed && (
                              <div className="mt-3 grid gap-3 text-xs leading-6 text-slate-600 md:grid-cols-2">
                                <div>
                                  <p className="font-bold uppercase tracking-[0.14em] text-slate-400">Получено</p>
                                  <pre className="mt-1 overflow-auto rounded-2xl bg-slate-950 p-3 text-amber-200">{item.actual || '(пусто)'}</pre>
                                </div>
                                <div>
                                  <p className="font-bold uppercase tracking-[0.14em] text-slate-400">Ошибка</p>
                                  <pre className="mt-1 overflow-auto rounded-2xl bg-slate-950 p-3 text-rose-200">{item.stderr || 'Нет системной ошибки, просто другой вывод.'}</pre>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <aside className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Подсказки</p>
                <div className="mt-3 space-y-2">
                  {task.hints.slice(0, completedHints).map((hint, index) => (
                    <div key={`${hint}-${index}`} className="rounded-2xl bg-white p-3 text-sm text-slate-700">
                      {hint}
                    </div>
                  ))}
                  {completedHints === 0 && <p className="text-sm text-slate-500">Подсказки появятся здесь по запросу.</p>}
                </div>
              </aside>
            </div>
          </article>
        ) : (
          <article id="practice" className="codequest-card p-6">
            <p className="text-sm text-slate-500">В этом уроке нет отдельной практической задачи.</p>
          </article>
        )}

        {quiz ? (
          <article id="quiz" className="codequest-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-sky-600">Итоговый квиз</p>
                <h2 className="mt-2 break-words text-xl font-black text-slate-900 sm:text-2xl">{quiz.title}</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700">Порог {quiz.passing_score}%</span>
                <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Ответов: {answeredQuizCount}/{quiz.questions.length}</span>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              {quiz.questions.map((question, index) => (
                <QuestionCard
                  key={question.id}
                  question={question}
                  value={quizAnswers[question.id]}
                  onChange={(next) => setQuizAnswers((prev) => ({ ...prev, [question.id]: next }))}
                  number={index + 1}
                />
              ))}
            </div>
            <button disabled={loadingQuiz} onClick={submitQuiz} className="mt-5 w-full rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
              {loadingQuiz ? 'Проверяем…' : 'Проверить квиз'}
            </button>
          </article>
        ) : (
          <article id="quiz" className="codequest-card p-6">
            <p className="text-sm text-slate-500">Для этого урока квиз не добавлен.</p>
          </article>
        )}

        <section className="lesson-completion-card">
          <div className="lesson-completion-shell">
            <div className="lesson-completion-badge" aria-hidden="true">
              <span className="lesson-completion-badge-icon">{completionBadgeLabel}</span>
            </div>
            <div className="lesson-completion-copy">
              <p className="lesson-completion-eyebrow">Завершение урока</p>
              <h2 className="lesson-completion-title">{completionTitle}</h2>
              <p className="lesson-completion-description">{completionDescription}</p>
              <div className="lesson-completion-meta">
                <span className="lesson-completion-chip lesson-completion-chip-progress">Прогресс {progressPercent}%</span>
                <span className="lesson-completion-chip lesson-completion-chip-status">Статус: {progressStatusLabel}</span>
                <span className="lesson-completion-chip lesson-completion-chip-next">
                  {nextLesson ? `Дальше: ${nextLesson.title}` : 'Это последний урок модуля'}
                </span>
              </div>
            </div>
            <div className="lesson-completion-actions">
              <button
                type="button"
                disabled={savingCompletion}
                onClick={() => finishLesson('/roadmap')}
                className="lesson-completion-button lesson-completion-button-roadmap"
              >
                <span className="lesson-completion-button-title">
                  {savingCompletion ? 'Сохраняем...' : 'Перейти в Roadmap'}
                </span>
                <span className="lesson-completion-button-hint">К карте модулей и следующему выбору</span>
              </button>
              <button
                type="button"
                disabled={savingCompletion || !canOpenNextLesson}
                onClick={() => nextLesson && finishLesson(`/lessons/${nextLesson.id}`)}
                className="lesson-completion-button lesson-completion-button-next"
              >
                <span className="lesson-completion-button-title">{nextActionTitle}</span>
                <span className="lesson-completion-button-hint">{nextActionHint}</span>
              </button>
            </div>
          </div>
        </section>

        {result && <section className={`codequest-card p-4 text-sm font-semibold ${resultClass}`}>{result}</section>}
        </section>
      </div>

      <LessonGigachatDrawer
        lessonId={lessonId}
        lessonTitle={lesson.title}
        lessonSummary={lesson.summary}
        moduleTitle={lesson.module.title}
        ageGroup={lesson.module.age_group}
        durationMinutes={lesson.duration_minutes}
        theoryHighlights={theoryHighlights}
        interactiveHighlights={interactiveHighlights}
        practiceTaskTitle={task?.title}
        practiceTaskPrompt={task?.prompt}
        quizTitle={quiz?.title}
        draftAnswer={answer}
      />
    </>
  )
}
