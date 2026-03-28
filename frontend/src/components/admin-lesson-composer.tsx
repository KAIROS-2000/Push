'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { hasExplicitCodeTaskIntent } from '@/lib/task-intent'
import { CodeTaskLanguage, ModuleItem } from '@/types'

type PracticeMode = 'none' | 'text' | 'code'
type TextEvaluationMode = 'manual' | 'keywords'
type QuizQuestionType = 'single' | 'multiple' | 'order' | 'match' | 'text'

interface JudgeTestCase {
  input: string
  expected: string
}

interface ChoiceOptionDraft {
  id: string
  text: string
  correct: boolean
}

interface MatchPairDraft {
  id: string
  left: string
  right: string
}

interface QuizQuestionDraft {
  id: string
  type: QuizQuestionType
  prompt: string
  options: ChoiceOptionDraft[]
  order_items: string
  correct_order: string
  pairs: MatchPairDraft[]
  accepted_answers: string
}

interface LessonComposerState {
  module_id: string
  insert_position: string
  publish_module_if_needed: boolean
  title: string
  summary: string
  theory_text: string
  key_points: string
  interactive_steps: string
  duration_minutes: string
  passing_score: string
  practice_mode: PracticeMode
  task_title: string
  task_prompt: string
  evaluation_mode: TextEvaluationMode
  programming_language: CodeTaskLanguage
  answer_keywords: string
  starter_code: string
  task_hints: string
  time_limit_ms: string
  memory_limit_mb: string
  judge_tests: JudgeTestCase[]
  quiz_enabled: boolean
  quiz_title: string
  quiz_passing_score: string
  quiz_questions: QuizQuestionDraft[]
}

interface AdminLessonComposerProps {
  modules: ModuleItem[]
  onMessage: (message: string) => void
  onReload: () => Promise<void>
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

const PRACTICE_MODE_OPTIONS: Array<{ value: PracticeMode; label: string; short: string }> = [
  { value: 'none', label: 'Без практики', short: 'Только теория и маршрут урока' },
  { value: 'text', label: 'Текстовое задание', short: 'Ответ вручную или по ключевым словам' },
  { value: 'code', label: 'Кодовая задача', short: 'Редактор, язык и автотесты' },
]

const TEXT_EVALUATION_OPTIONS: Array<{ value: TextEvaluationMode; label: string; short: string }> = [
  { value: 'manual', label: 'Ручная проверка', short: 'Подходит для длинных объяснений и эссе.' },
  { value: 'keywords', label: 'По ключевым словам', short: 'Система ищет ориентиры в тексте ответа.' },
]

const QUIZ_TYPE_OPTIONS: Array<{ value: QuizQuestionType; label: string; short: string }> = [
  { value: 'single', label: 'Один ответ', short: 'Один правильный вариант из нескольких.' },
  { value: 'multiple', label: 'Несколько ответов', short: 'Можно отметить несколько верных вариантов.' },
  { value: 'order', label: 'Порядок', short: 'Ученик должен расставить шаги в правильной последовательности.' },
  { value: 'match', label: 'Сопоставление', short: 'Нужно соединить элементы из двух колонок.' },
  { value: 'text', label: 'Текстовый ответ', short: 'Короткий текст с одним или несколькими допустимыми ответами.' },
]

function createLocalId(prefix = 'item') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function splitLines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function defaultLanguageForModule(module?: ModuleItem | null): CodeTaskLanguage {
  return module?.age_group === 'senior' ? 'javascript' : 'python'
}

function moduleSupportsCode(module?: ModuleItem | null) {
  return module?.age_group !== 'junior'
}

function createEmptyTest(): JudgeTestCase {
  return { input: '', expected: '' }
}

function createChoiceOption(): ChoiceOptionDraft {
  return { id: createLocalId('option'), text: '', correct: false }
}

function createMatchPair(): MatchPairDraft {
  return { id: createLocalId('pair'), left: '', right: '' }
}

function createQuizQuestion(type: QuizQuestionType = 'single'): QuizQuestionDraft {
  return {
    id: createLocalId('question'),
    type,
    prompt: '',
    options: type === 'single' || type === 'multiple' ? [createChoiceOption(), createChoiceOption()] : [],
    order_items: '',
    correct_order: '',
    pairs: type === 'match' ? [createMatchPair(), createMatchPair()] : [],
    accepted_answers: '',
  }
}

function createEmptyComposerState(module?: ModuleItem | null): LessonComposerState {
  return {
    module_id: module ? String(module.id) : '',
    insert_position: module ? String(module.lessons.length + 1) : '1',
    publish_module_if_needed: true,
    title: '',
    summary: '',
    theory_text: '',
    key_points: '',
    interactive_steps: '',
    duration_minutes: '10',
    passing_score: '70',
    practice_mode: moduleSupportsCode(module) ? 'text' : 'none',
    task_title: '',
    task_prompt: '',
    evaluation_mode: 'manual',
    programming_language: defaultLanguageForModule(module),
    answer_keywords: '',
    starter_code: '',
    task_hints: '',
    time_limit_ms: '2000',
    memory_limit_mb: '128',
    judge_tests: [createEmptyTest()],
    quiz_enabled: false,
    quiz_title: '',
    quiz_passing_score: '70',
    quiz_questions: [],
  }
}

function questionHasContent(question: QuizQuestionDraft) {
  return Boolean(
    question.prompt.trim()
    || question.options.some((option) => option.text.trim())
    || question.order_items.trim()
    || question.correct_order.trim()
    || question.pairs.some((pair) => pair.left.trim() || pair.right.trim())
    || question.accepted_answers.trim(),
  )
}

export function AdminLessonComposer({ modules, onMessage, onReload }: AdminLessonComposerProps) {
  const catalogModules = useMemo(
    () => modules
      .filter((module) => !module.is_custom_classroom_module)
      .sort((left, right) => left.order_index - right.order_index),
    [modules],
  )
  const [form, setForm] = useState<LessonComposerState>(() => createEmptyComposerState(catalogModules[0]))
  const [lastCreatedLesson, setLastCreatedLesson] = useState<{ id: number; title: string; summary: string } | null>(null)

  const selectedModule = useMemo(
    () => catalogModules.find((module) => String(module.id) === form.module_id) || catalogModules[0] || null,
    [catalogModules, form.module_id],
  )
  const orderedLessons = useMemo(
    () => [...(selectedModule?.lessons || [])].sort((left, right) => left.order_index - right.order_index),
    [selectedModule],
  )
  const supportsCode = moduleSupportsCode(selectedModule)
  const configuredJudgeTests = useMemo(
    () => form.judge_tests.filter((testCase) => testCase.input.trim() || testCase.expected.trim()),
    [form.judge_tests],
  )
  const roadmapVisible = Boolean(selectedModule && (selectedModule.is_published || form.publish_module_if_needed))

  useEffect(() => {
    if (!catalogModules.length) {
      setForm(createEmptyComposerState())
      return
    }
    if (!catalogModules.some((module) => String(module.id) === form.module_id)) {
      setForm((current) => ({
        ...createEmptyComposerState(catalogModules[0]),
        publish_module_if_needed: current.publish_module_if_needed,
      }))
    }
  }, [catalogModules, form.module_id])

  useEffect(() => {
    if (!supportsCode && form.practice_mode === 'code') {
      setForm((current) => ({
        ...current,
        practice_mode: 'text',
        programming_language: defaultLanguageForModule(selectedModule),
      }))
    }
  }, [supportsCode, form.practice_mode, selectedModule])

  function handleModuleChange(nextModuleId: string) {
    const nextModule = catalogModules.find((module) => String(module.id) === nextModuleId) || null
    setForm((current) => ({
      ...current,
      module_id: nextModuleId,
      insert_position: nextModule ? String(nextModule.lessons.length + 1) : '1',
      programming_language: defaultLanguageForModule(nextModule),
      practice_mode: !moduleSupportsCode(nextModule) && current.practice_mode === 'code' ? 'text' : current.practice_mode,
    }))
  }

  function resetComposer() {
    setForm(createEmptyComposerState(selectedModule))
  }

  function addJudgeTest() {
    setForm((current) => ({
      ...current,
      judge_tests: [...current.judge_tests, createEmptyTest()],
    }))
  }

  function updateJudgeTest(index: number, patch: Partial<JudgeTestCase>) {
    setForm((current) => ({
      ...current,
      judge_tests: current.judge_tests.map((testCase, testIndex) => (
        testIndex === index ? { ...testCase, ...patch } : testCase
      )),
    }))
  }

  function removeJudgeTest(index: number) {
    setForm((current) => ({
      ...current,
      judge_tests: current.judge_tests.filter((_, testIndex) => testIndex !== index),
    }))
  }

  function addQuizQuestion(type: QuizQuestionType) {
    setForm((current) => ({
      ...current,
      quiz_questions: [...current.quiz_questions, createQuizQuestion(type)],
      quiz_enabled: true,
    }))
  }

  function updateQuizQuestion(index: number, patch: Partial<QuizQuestionDraft>) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, questionIndex) => (
        questionIndex === index ? { ...question, ...patch } : question
      )),
    }))
  }

  function replaceQuizQuestion(index: number, nextQuestion: QuizQuestionDraft) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, questionIndex) => (
        questionIndex === index ? nextQuestion : question
      )),
    }))
  }

  function removeQuizQuestion(index: number) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.filter((_, questionIndex) => questionIndex !== index),
    }))
  }

  function addQuestionOption(questionIndex: number) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, index) => (
        index === questionIndex
          ? { ...question, options: [...question.options, createChoiceOption()] }
          : question
      )),
    }))
  }

  function updateQuestionOption(questionIndex: number, optionId: string, patch: Partial<ChoiceOptionDraft>) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, index) => (
        index === questionIndex
          ? {
              ...question,
              options: question.options.map((option) => (
                option.id === optionId ? { ...option, ...patch } : option
              )),
            }
          : question
      )),
    }))
  }

  function toggleCorrectOption(questionIndex: number, optionId: string) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, index) => {
        if (index !== questionIndex) return question
        return {
          ...question,
          options: question.options.map((option) => (
            question.type === 'single'
              ? { ...option, correct: option.id === optionId }
              : option.id === optionId
                ? { ...option, correct: !option.correct }
                : option
          )),
        }
      }),
    }))
  }

  function removeQuestionOption(questionIndex: number, optionId: string) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, index) => (
        index === questionIndex
          ? { ...question, options: question.options.filter((option) => option.id !== optionId) }
          : question
      )),
    }))
  }

  function addMatchPairToQuestion(questionIndex: number) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, index) => (
        index === questionIndex
          ? { ...question, pairs: [...question.pairs, createMatchPair()] }
          : question
      )),
    }))
  }

  function updateMatchPair(questionIndex: number, pairId: string, patch: Partial<MatchPairDraft>) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, index) => (
        index === questionIndex
          ? {
              ...question,
              pairs: question.pairs.map((pair) => (
                pair.id === pairId ? { ...pair, ...patch } : pair
              )),
            }
          : question
      )),
    }))
  }

  function removeMatchPair(questionIndex: number, pairId: string) {
    setForm((current) => ({
      ...current,
      quiz_questions: current.quiz_questions.map((question, index) => (
        index === questionIndex
          ? { ...question, pairs: question.pairs.filter((pair) => pair.id !== pairId) }
          : question
      )),
    }))
  }

  function buildQuizPayload() {
    const questions: Array<Record<string, unknown>> = []

    for (const [index, question] of form.quiz_questions.entries()) {
      if (!questionHasContent(question)) continue
      const questionNumber = index + 1
      const prompt = question.prompt.trim()
      if (!prompt) {
        return { error: `Заполните формулировку вопроса №${questionNumber}.`, questions: [] }
      }

      if (question.type === 'single' || question.type === 'multiple') {
        const options = question.options
          .map((option) => ({ text: option.text.trim(), correct: option.correct }))
          .filter((option) => option.text)
        if (options.length < 2) {
          return { error: `В вопросе №${questionNumber} нужно минимум два варианта ответа.`, questions: [] }
        }
        const correct = options
          .map((option, optionIndex) => option.correct ? optionIndex : -1)
          .filter((value) => value >= 0)
        if (question.type === 'single' && correct.length !== 1) {
          return { error: `Для вопроса №${questionNumber} выберите ровно один правильный вариант.`, questions: [] }
        }
        if (question.type === 'multiple' && correct.length === 0) {
          return { error: `Для вопроса №${questionNumber} отметьте хотя бы один правильный вариант.`, questions: [] }
        }
        questions.push({
          type: question.type,
          prompt,
          options: options.map((option) => option.text),
          correct,
        })
        continue
      }

      if (question.type === 'order') {
        const items = splitLines(question.order_items)
        const correct = splitLines(question.correct_order)
        if (items.length < 2) {
          return { error: `В вопросе №${questionNumber} добавьте минимум два шага.`, questions: [] }
        }
        if (correct.length !== items.length || [...correct].sort().join('|') !== [...items].sort().join('|')) {
          return { error: `Для вопроса №${questionNumber} правильный порядок должен содержать те же пункты, что и список шагов.`, questions: [] }
        }
        questions.push({ type: question.type, prompt, items, correct })
        continue
      }

      if (question.type === 'match') {
        const pairs = question.pairs
          .map((pair) => ({ left: pair.left.trim(), right: pair.right.trim() }))
          .filter((pair) => pair.left && pair.right)
        if (pairs.length < 2) {
          return { error: `В вопросе №${questionNumber} добавьте минимум две пары для сопоставления.`, questions: [] }
        }
        const uniqueLeft = new Set(pairs.map((pair) => pair.left))
        const uniqueRight = new Set(pairs.map((pair) => pair.right))
        if (uniqueLeft.size !== pairs.length) {
          return { error: `В вопросе №${questionNumber} левые значения должны быть уникальными.`, questions: [] }
        }
        if (uniqueRight.size < 2) {
          return { error: `В вопросе №${questionNumber} нужно минимум два разных значения в правой колонке.`, questions: [] }
        }
        questions.push({ type: question.type, prompt, pairs })
        continue
      }

      const correct = splitLines(question.accepted_answers)
      if (!correct.length) {
        return { error: `Для вопроса №${questionNumber} добавьте хотя бы один допустимый ответ.`, questions: [] }
      }
      questions.push({ type: question.type, prompt, correct })
    }

    return { error: '', questions }
  }

  async function createLesson(event: FormEvent) {
    event.preventDefault()
    if (!selectedModule) {
      onMessage('Сначала создайте хотя бы один обычный модуль для roadmap.')
      return
    }
    if (!form.title.trim() || !form.summary.trim()) {
      onMessage('Укажите название и краткое описание урока.')
      return
    }
    if (
      form.practice_mode === 'text'
      && hasExplicitCodeTaskIntent({
        title: form.task_title,
        prompt: form.task_prompt,
        starterCode: form.starter_code,
      })
    ) {
      onMessage('Похоже, это кодовая практика. Выберите формат "Кодовая задача" и добавьте автотесты.')
      return
    }
    if (form.practice_mode === 'code' && configuredJudgeTests.length === 0) {
      onMessage('Для кодового задания добавьте хотя бы один тест с входом и ожидаемым результатом.')
      return
    }
    if (form.practice_mode === 'text' && form.evaluation_mode === 'keywords' && !form.answer_keywords.trim()) {
      onMessage('Для автопроверки по ключевым словам заполните ориентиры ответа.')
      return
    }

    const quizPayload = buildQuizPayload()
    if (form.quiz_enabled && quizPayload.error) {
      onMessage(quizPayload.error)
      return
    }
    if (form.quiz_enabled && quizPayload.questions.length === 0) {
      onMessage('Добавьте хотя бы один вопрос в итоговый квиз.')
      return
    }

    try {
      const data = await api<CreateLessonResponse>(
        `/admin/modules/${selectedModule.id}/lessons`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: form.title,
            summary: form.summary,
            theory_text: form.theory_text,
            key_points: form.key_points,
            interactive_steps: form.interactive_steps,
            duration_minutes: Number(form.duration_minutes || 10),
            passing_score: Number(form.passing_score || 70),
            insert_position: Number(form.insert_position || orderedLessons.length + 1),
            publish_module_if_needed: form.publish_module_if_needed,
            task: {
              enabled: form.practice_mode !== 'none',
              task_type: form.practice_mode === 'code' ? 'code' : 'text',
              title: form.task_title,
              prompt: form.task_prompt,
              evaluation_mode: form.practice_mode === 'code' ? 'stdin_stdout' : form.evaluation_mode,
              language: form.practice_mode === 'code' ? form.programming_language : null,
              keywords: form.practice_mode === 'text' && form.evaluation_mode === 'keywords' ? form.answer_keywords : '',
              starter_code: form.practice_mode === 'code' ? form.starter_code : '',
              hints: form.task_hints,
              tests: form.practice_mode === 'code'
                ? configuredJudgeTests.map((testCase, index) => ({
                    label: `Тест ${index + 1}`,
                    input: testCase.input,
                    expected: testCase.expected,
                  }))
                : [],
              time_limit_ms: form.practice_mode === 'code' ? Number(form.time_limit_ms || 2000) : null,
              memory_limit_mb: form.practice_mode === 'code' ? Number(form.memory_limit_mb || 128) : null,
            },
            quiz: {
              enabled: form.quiz_enabled,
              title: form.quiz_title,
              passing_score: Number(form.quiz_passing_score || 70),
              questions: quizPayload.questions,
            },
          }),
        },
        true,
      )
      setLastCreatedLesson(data.lesson)
      setForm((current) => ({
        ...createEmptyComposerState(selectedModule),
        module_id: current.module_id,
        insert_position: String((data.module.lessons?.length || orderedLessons.length) + 1),
        publish_module_if_needed: current.publish_module_if_needed,
      }))
      onMessage(
        data.roadmap_visible
          ? 'Урок создан и уже попадёт в roadmap выбранной возрастной группы.'
          : 'Урок создан, но модуль пока скрыт от roadmap. Включите публикацию модуля.',
      )
      await onReload().catch(() => undefined)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Не удалось создать урок.')
    }
  }

  if (!catalogModules.length) {
    return (
      <section className="codequest-card p-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">Конструктор урока</p>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Сначала создайте обычный модуль. После этого сюда можно будет добавить урок в любую позицию roadmap, практику и итоговый квиз.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      {lastCreatedLesson && (
        <div className="codequest-card border border-emerald-200 bg-emerald-50/80 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-600">Последний созданный урок</p>
              <h3 className="mt-2 text-xl font-black text-slate-900">{lastCreatedLesson.title}</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{lastCreatedLesson.summary}</p>
            </div>
            <Link href={`/lessons/${lastCreatedLesson.id}`} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Открыть урок
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={createLesson} className="codequest-card overflow-hidden">
        <div
          className="border-b border-white/40 p-6 text-white"
          style={{
            backgroundColor: '#0f172a',
            backgroundImage: `
              linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px),
              linear-gradient(135deg, #0f172a 0%, #1d4ed8 48%, #10b981 100%)
            `,
            backgroundSize: '30px 30px, 30px 30px, 100% 100%',
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-emerald-100">Новый урок в roadmap</p>
              <h3 className="mt-3 text-3xl font-black">Добавьте урок в нужное место</h3>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-sky-50/90">
                Урок можно вставить в любое место модуля, сразу собрать практику, настроить автопроверку кода и добавить итоговый квиз.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-white/12 px-3 py-2 backdrop-blur">{selectedModule?.title}</span>
              <span className="rounded-full bg-white/12 px-3 py-2 backdrop-blur">{selectedModule?.age_group}</span>
              <span className="rounded-full bg-white/12 px-3 py-2 backdrop-blur">{roadmapVisible ? 'Будет в roadmap' : 'Скрыт до публикации'}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-6 p-6">
          <div className="min-w-0 flex-[999_1_46rem] space-y-5">
            <section className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">1. Позиция в roadmap</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <select className="rounded-2xl border border-slate-200 px-4 py-3" value={form.module_id} onChange={(event) => handleModuleChange(event.target.value)}>
                  {catalogModules.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.title} ({module.age_group})
                    </option>
                  ))}
                </select>
                <select className="rounded-2xl border border-slate-200 px-4 py-3" value={form.insert_position} onChange={(event) => setForm({ ...form, insert_position: event.target.value })}>
                  {Array.from({ length: orderedLessons.length + 1 }, (_, index) => {
                    const position = index + 1
                    const previousLesson = orderedLessons[position - 2]
                    const label = position === 1
                      ? '1. В начало модуля'
                      : `${position}. После «${previousLesson?.title || 'предыдущего урока'}»`
                    return (
                      <option key={position} value={position}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              </div>
              <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.publish_module_if_needed}
                  onChange={(event) => setForm({ ...form, publish_module_if_needed: event.target.checked })}
                />
                <span>
                  Если модуль ещё не опубликован, сразу открыть его для roadmap.
                  <span className="mt-1 block text-xs text-slate-500">
                    Сейчас модуль {selectedModule?.is_published ? 'уже опубликован' : 'скрыт от учеников'}.
                  </span>
                </span>
              </label>
            </section>

            <section className="rounded-[26px] border border-slate-200 bg-white p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">2. Основа урока</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="Название урока" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <input className="rounded-2xl border border-slate-200 px-4 py-3" type="number" min={5} max={180} placeholder="Минуты" value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })} />
                  <input className="rounded-2xl border border-slate-200 px-4 py-3" type="number" min={0} max={100} placeholder="Порог %" value={form.passing_score} onChange={(event) => setForm({ ...form, passing_score: event.target.value })} />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Возрастная группа модуля: <span className="font-semibold text-slate-900">{selectedModule?.age_group}</span>
                </div>
                <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="Краткое описание урока" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
              </div>
            </section>

            <section className="rounded-[26px] border border-slate-200 bg-white p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">3. Контент</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <textarea className="min-h-32 rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="Основное объяснение темы" value={form.theory_text} onChange={(event) => setForm({ ...form, theory_text: event.target.value })} />
                <div>
                  <textarea className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Ключевые идеи, каждая с новой строки" value={form.key_points} onChange={(event) => setForm({ ...form, key_points: event.target.value })} />
                  <p className="mt-2 text-xs text-slate-500">Идей: {splitLines(form.key_points).length}</p>
                </div>
                <div>
                  <textarea className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Шаги разбора, каждый с новой строки" value={form.interactive_steps} onChange={(event) => setForm({ ...form, interactive_steps: event.target.value })} />
                  <p className="mt-2 text-xs text-slate-500">Шагов: {splitLines(form.interactive_steps).length}</p>
                </div>
              </div>
            </section>

            <section className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">4. Практика</p>
                  <h4 className="mt-2 text-2xl font-black text-slate-900">Тип задания и проверка</h4>
                </div>
                {!supportsCode && (
                  <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
                    Для Junior кодовые задания отключены
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {PRACTICE_MODE_OPTIONS.filter((option) => option.value !== 'code' || supportsCode).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setForm({ ...form, practice_mode: option.value })}
                    className={`rounded-[24px] border p-4 text-left transition ${form.practice_mode === option.value ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  >
                    <p className="text-base font-black text-slate-900">{option.label}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{option.short}</p>
                  </button>
                ))}
              </div>

              {form.practice_mode === 'none' ? (
                <div className="mt-4 rounded-[22px] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                  Урок сохранится без встроенной практики. В roadmap останутся теория, разбор и при желании итоговый квиз.
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Название задания" value={form.task_title} onChange={(event) => setForm({ ...form, task_title: event.target.value })} />
                    <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Формулировка задания" value={form.task_prompt} onChange={(event) => setForm({ ...form, task_prompt: event.target.value })} />
                  </div>

                  {form.practice_mode === 'text' && (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        {TEXT_EVALUATION_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setForm({ ...form, evaluation_mode: option.value })}
                            className={`rounded-[22px] border p-4 text-left transition ${form.evaluation_mode === option.value ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                          >
                            <p className="text-base font-black text-slate-900">{option.label}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{option.short}</p>
                          </button>
                        ))}
                      </div>

                      {form.evaluation_mode === 'keywords' && (
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
                          <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Ключевые слова через запятую" value={form.answer_keywords} onChange={(event) => setForm({ ...form, answer_keywords: event.target.value })} />
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                            Эти ориентиры система будет искать в тексте ответа ученика.
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {form.practice_mode === 'code' && (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <select className="rounded-2xl border border-slate-200 px-4 py-3" value={form.programming_language} onChange={(event) => setForm({ ...form, programming_language: event.target.value as CodeTaskLanguage })}>
                          <option value="python">Python</option>
                          <option value="javascript">JavaScript</option>
                        </select>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          Кодовая задача всегда проверяется автотестами. Укажите вход и ожидаемый вывод для каждого теста.
                        </div>
                      </div>

                      <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <input className="rounded-2xl border border-slate-200 px-4 py-3" type="number" min={500} max={10000} placeholder="Лимит времени, мс" value={form.time_limit_ms} onChange={(event) => setForm({ ...form, time_limit_ms: event.target.value })} />
                          <input className="rounded-2xl border border-slate-200 px-4 py-3" type="number" min={32} max={1024} placeholder="Память, МБ" value={form.memory_limit_mb} onChange={(event) => setForm({ ...form, memory_limit_mb: event.target.value })} />
                        </div>
                        {form.judge_tests.map((testCase, index) => (
                          <div key={`${index}-${testCase.input.length}-${testCase.expected.length}`} className="rounded-[22px] border border-slate-200 bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm font-black text-slate-900">Тест {index + 1}</p>
                              {form.judge_tests.length > 1 && (
                                <button type="button" onClick={() => removeJudgeTest(index)} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                  Удалить
                                </button>
                              )}
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs leading-6" placeholder="stdin" value={testCase.input} onChange={(event) => updateJudgeTest(index, { input: event.target.value })} />
                              <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs leading-6" placeholder="Ожидаемый stdout" value={testCase.expected} onChange={(event) => updateJudgeTest(index, { expected: event.target.value })} />
                            </div>
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={addJudgeTest} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                            Добавить тест
                          </button>
                          <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600">
                            Активных тестов: {configuredJudgeTests.length}
                          </span>
                        </div>
                      </div>

                      <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs leading-6" placeholder="Стартовый код" value={form.starter_code} onChange={(event) => setForm({ ...form, starter_code: event.target.value })} />
                    </>
                  )}

                  <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Подсказки к заданию, каждая с новой строки" value={form.task_hints} onChange={(event) => setForm({ ...form, task_hints: event.target.value })} />
                </div>
              )}
            </section>

            <section className="rounded-[26px] border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">5. Итоговый квиз</p>
                  <h4 className="mt-2 text-2xl font-black text-slate-900">Все типы вопросов</h4>
                </div>
                <label className="flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={form.quiz_enabled} onChange={(event) => setForm({ ...form, quiz_enabled: event.target.checked })} />
                  Добавить квиз
                </label>
              </div>

              {form.quiz_enabled ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Название квиза" value={form.quiz_title} onChange={(event) => setForm({ ...form, quiz_title: event.target.value })} />
                    <input className="rounded-2xl border border-slate-200 px-4 py-3" type="number" min={0} max={100} placeholder="Порог квиза %" value={form.quiz_passing_score} onChange={(event) => setForm({ ...form, quiz_passing_score: event.target.value })} />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {QUIZ_TYPE_OPTIONS.map((option) => (
                      <button key={option.value} type="button" onClick={() => addQuizQuestion(option.value)} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                        + {option.label}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-4">
                    {form.quiz_questions.length === 0 && (
                      <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                        Добавьте хотя бы один вопрос. Доступны одиночный выбор, множественный выбор, порядок, сопоставление и текстовый ответ.
                      </div>
                    )}

                    {form.quiz_questions.map((question, questionIndex) => {
                      const typeMeta = QUIZ_TYPE_OPTIONS.find((option) => option.value === question.type)
                      return (
                        <div key={question.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Вопрос {questionIndex + 1}</p>
                              <p className="mt-2 text-lg font-black text-slate-900">{typeMeta?.label}</p>
                              <p className="mt-1 text-sm text-slate-600">{typeMeta?.short}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <select
                                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                                value={question.type}
                                onChange={(event) => replaceQuizQuestion(questionIndex, createQuizQuestion(event.target.value as QuizQuestionType))}
                              >
                                {QUIZ_TYPE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                              <button type="button" onClick={() => removeQuizQuestion(questionIndex)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                                Удалить
                              </button>
                            </div>
                          </div>

                          <textarea className="mt-4 min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Текст вопроса" value={question.prompt} onChange={(event) => updateQuizQuestion(questionIndex, { prompt: event.target.value })} />

                          {(question.type === 'single' || question.type === 'multiple') && (
                            <div className="mt-4 space-y-3">
                              {question.options.map((option) => (
                                <div key={option.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
                                  <button
                                    type="button"
                                    onClick={() => toggleCorrectOption(questionIndex, option.id)}
                                    className={`rounded-full px-3 py-2 text-xs font-bold ${option.correct ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                                  >
                                    {question.type === 'single' ? (option.correct ? 'Верный' : 'Выбрать') : (option.correct ? 'Верный' : 'Отметить')}
                                  </button>
                                  <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Текст варианта" value={option.text} onChange={(event) => updateQuestionOption(questionIndex, option.id, { text: event.target.value })} />
                                  <button type="button" onClick={() => removeQuestionOption(questionIndex, option.id)} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                                    Удалить
                                  </button>
                                </div>
                              ))}
                              <button type="button" onClick={() => addQuestionOption(questionIndex)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                                Добавить вариант
                              </button>
                            </div>
                          )}

                          {question.type === 'order' && (
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Шаги в перемешанном порядке, каждый с новой строки" value={question.order_items} onChange={(event) => updateQuizQuestion(questionIndex, { order_items: event.target.value })} />
                              <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Правильный порядок, каждый с новой строки" value={question.correct_order} onChange={(event) => updateQuizQuestion(questionIndex, { correct_order: event.target.value })} />
                            </div>
                          )}

                          {question.type === 'match' && (
                            <div className="mt-4 space-y-3">
                              {question.pairs.map((pair) => (
                                <div key={pair.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                                  <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Левая колонка" value={pair.left} onChange={(event) => updateMatchPair(questionIndex, pair.id, { left: event.target.value })} />
                                  <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Правильная пара" value={pair.right} onChange={(event) => updateMatchPair(questionIndex, pair.id, { right: event.target.value })} />
                                  <button type="button" onClick={() => removeMatchPair(questionIndex, pair.id)} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                                    Удалить
                                  </button>
                                </div>
                              ))}
                              <button type="button" onClick={() => addMatchPairToQuestion(questionIndex)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                                Добавить пару
                              </button>
                            </div>
                          )}

                          {question.type === 'text' && (
                            <textarea className="mt-4 min-h-28 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Допустимые ответы, каждый с новой строки" value={question.accepted_answers} onChange={(event) => updateQuizQuestion(questionIndex, { accepted_answers: event.target.value })} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-[22px] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                  Квиз необязателен, но если нужен итоговый контроль, сюда можно добавить все поддерживаемые типы вопросов.
                </div>
              )}
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[26px] border border-slate-200 bg-slate-50/80 p-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Финальный шаг</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  После сохранения урок сразу окажется в выбранной позиции модуля.
                  {roadmapVisible ? ' Для учеников он будет виден в roadmap.' : ' Пока модуль не опубликован, roadmap его не покажет.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={resetComposer} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">Очистить</button>
                <button className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Создать урок</button>
              </div>
            </div>
          </div>

          <aside className="min-w-0 flex-[1_1_320px] space-y-4">
            <div className="rounded-[26px] border border-slate-900 bg-slate-900 p-5 text-white">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300">Краткая сводка</p>
              <div className="mt-4 space-y-3 text-sm text-slate-200">
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="font-semibold text-white">Модуль</p>
                  <p className="mt-1">{selectedModule?.title}</p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="font-semibold text-white">Позиция</p>
                  <p className="mt-1">{form.insert_position} из {orderedLessons.length + 1}</p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="font-semibold text-white">Практика</p>
                  <p className="mt-1">
                    {form.practice_mode === 'none'
                      ? 'Нет'
                      : form.practice_mode === 'code'
                        ? `Кодовая (${form.programming_language})`
                        : form.evaluation_mode === 'keywords'
                          ? 'Текстовая с автопроверкой'
                          : 'Текстовая с ручной проверкой'}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="font-semibold text-white">Автотесты</p>
                  <p className="mt-1">{configuredJudgeTests.length}</p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="font-semibold text-white">Квиз</p>
                  <p className="mt-1">{form.quiz_enabled ? `${form.quiz_questions.filter(questionHasContent).length} вопрос(ов)` : 'Не добавлен'}</p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <p className="font-semibold text-white">Roadmap</p>
                  <p className="mt-1">{roadmapVisible ? 'Урок появится у учеников' : 'Нужно опубликовать модуль'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Советы</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <li>Если урок должен сразу выйти в roadmap, оставьте включённой публикацию модуля.</li>
                <li>Для кода используйте короткие тесты с явным ожидаемым выводом.</li>
                <li>В квизах с порядком правильная последовательность должна содержать те же строки, что и исходный список.</li>
                <li>В вопросах на сопоставление достаточно заполнить пары, список справа соберётся автоматически.</li>
              </ul>
            </div>
          </aside>
        </div>
      </form>
    </div>
  )
}
