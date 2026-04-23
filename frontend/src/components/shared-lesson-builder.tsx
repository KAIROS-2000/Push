'use client'

import { api } from '@/lib/api'
import { hasExplicitCodeTaskIntent } from '@/lib/task-intent'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'
import type { ClassroomItem, LessonCatalogItem, ModuleItem } from '@/types'
import clsx from 'clsx'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Eye,
  LayoutTemplate,
  ListChecks,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AGE_GROUP_OPTIONS,
  CHECK_OPTIONS,
  LESSON_FORMAT_OPTIONS,
  METHODICAL_SECTIONS,
  PRACTICE_OPTIONS,
  QUIZ_TYPE_OPTIONS,
  ageGroupSupportsCode,
  buildLessonSubmitData,
  buildQuizPayload,
  checkComplete,
  contentComplete,
  createChoiceOption,
  createEmptyTest,
  createInitialLessonBuilderForm,
  createMatchPair,
  createQuizQuestion,
  defaultLanguageForAgeGroup,
  foundationComplete,
  formatComplete,
  hasCompleteJudgeTest,
  normalizeAgeGroup,
  parseLines,
  practiceComplete,
  questionHasContent,
  quizComplete,
  type CheckMode,
  type CreatedLessonState,
  type JudgeTestCase,
  type LessonBuilderForm,
  type LessonBuilderSubmitData,
  type MatchPairDraft,
  type QuizQuestionDraft,
  type QuizQuestionType,
} from './lesson-builder-shared'

type BuilderMode = 'teacher' | 'admin'
type BuilderStepId = 'foundation' | 'format' | 'content' | 'practice' | 'check' | 'quiz' | 'confirm'

interface StepMeta {
  id: BuilderStepId
  title: string
  short: string
  icon: typeof LayoutTemplate
}

export interface SharedLessonBuilderFeatures {
  drafts: boolean
  sourcePrefill: boolean
  publishToggle: boolean
  insertPosition: boolean
  quiz: boolean
  help: boolean
}

interface ClassroomTargetConfig {
  kind: 'classroom'
  classes: ClassroomItem[]
  initialClassId?: number | null
  sourceLessonId?: number | null
  draftKey?: string
  createTargetHref?: string
}

interface ModuleTargetConfig {
  kind: 'module'
  modules: ModuleItem[]
}

export type SharedLessonBuilderTargetConfig = ClassroomTargetConfig | ModuleTargetConfig

export type SharedLessonBuilderTargetSelection =
  | { kind: 'classroom'; classroomId: number }
  | { kind: 'module'; moduleId: number; insertPosition: number; publishModuleIfNeeded: boolean }

export interface SharedLessonBuilderSubmitResult {
  lesson: CreatedLessonState
  successMessage: string
  nextInsertPosition?: string
}

interface SharedLessonBuilderProps {
  mode: BuilderMode
  features: SharedLessonBuilderFeatures
  targetConfig: SharedLessonBuilderTargetConfig
  cancelHref?: string | null
  submitLesson: (payload: {
    target: SharedLessonBuilderTargetSelection
    lesson: LessonBuilderSubmitData
  }) => Promise<SharedLessonBuilderSubmitResult>
  onCreated?: (result: SharedLessonBuilderSubmitResult) => Promise<void> | void
}

const BASE_STEPS: StepMeta[] = [
  { id: 'foundation', title: 'Основа', short: 'Базовые параметры урока', icon: LayoutTemplate },
  { id: 'format', title: 'Формат', short: 'Шаблон и логика подачи', icon: Sparkles },
  { id: 'content', title: 'Содержание', short: 'Теория и маршрут урока', icon: BookOpen },
  { id: 'practice', title: 'Практика', short: 'Формат практического задания', icon: ClipboardCheck },
  { id: 'check', title: 'Проверка', short: 'Как проверять ответ', icon: ShieldCheck },
  { id: 'quiz', title: 'Квиз', short: 'Итоговый контроль по теме', icon: ListChecks },
  { id: 'confirm', title: 'Подтверждение', short: 'Финальная проверка перед созданием', icon: Eye },
]

function getSteps(includeQuiz: boolean) {
  return includeQuiz ? BASE_STEPS : BASE_STEPS.filter(step => step.id !== 'quiz')
}

function nextButtonLabel(stepIndex: number, steps: StepMeta[]) {
  return stepIndex === steps.length - 1 ? 'Создать урок' : 'Далее'
}

function ensureDraftShape(value: unknown): value is {
  form: LessonBuilderForm
  currentStep: number
  selectedClassId?: number | null
} {
  if (!value || typeof value !== 'object') return false
  const parsed = value as {
    form?: LessonBuilderForm
    currentStep?: number
    selectedClassId?: number | null
  }
  return Boolean(parsed.form) && typeof parsed.currentStep === 'number'
}

function LabelBlock({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children?: ReactNode
}) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <span className='text-sm font-semibold text-slate-900'>{label}</span>
      <span
        className={clsx(
          'inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold',
          required ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-500',
        )}
      >
        {required ? 'Обязательное' : 'Дополнительно'}
      </span>
      {children}
    </div>
  )
}

function SidebarCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_20px_55px_rgba(15,23,42,0.06)]'>
      <h3 className='text-lg font-semibold text-slate-900'>{title}</h3>
      <div className='mt-4'>{children}</div>
    </section>
  )
}

function normalizeModuleList(modules: ModuleItem[]) {
  return modules
    .filter(module => !module.is_custom_classroom_module)
    .sort((left, right) => {
      if (left.order_index !== right.order_index) return left.order_index - right.order_index
      return left.id - right.id
    })
}

export function SharedLessonBuilder({
  mode,
  features,
  targetConfig,
  cancelHref = null,
  submitLesson,
  onCreated,
}: SharedLessonBuilderProps) {
  const manualCheckAvailable = mode === 'teacher'
  const textCheckFallback: CheckMode = manualCheckAvailable ? 'manual' : 'keywords'
  const moduleOptions = useMemo(
    () => targetConfig.kind === 'module' ? normalizeModuleList(targetConfig.modules) : [],
    [targetConfig],
  )
  const initialAgeGroup = targetConfig.kind === 'module'
    ? normalizeAgeGroup(moduleOptions[0]?.age_group)
    : 'junior'

  const [form, setForm] = useState<LessonBuilderForm>(() => {
    const initialForm = createInitialLessonBuilderForm(initialAgeGroup)
    return manualCheckAvailable
      ? initialForm
      : { ...initialForm, checkMode: 'keywords' }
  })
  const [currentStep, setCurrentStep] = useState(0)
  const [selectedClassId, setSelectedClassId] = useState<number | null>(
    targetConfig.kind === 'classroom'
      ? targetConfig.initialClassId ?? targetConfig.classes[0]?.id ?? null
      : null,
  )
  const [selectedModuleId, setSelectedModuleId] = useState<string>(
    targetConfig.kind === 'module' && moduleOptions[0] ? String(moduleOptions[0].id) : '',
  )
  const [insertPosition, setInsertPosition] = useState('1')
  const [publishModuleIfNeeded, setPublishModuleIfNeeded] = useState(true)
  const [catalog, setCatalog] = useState<LessonCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [creatingLesson, setCreatingLesson] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [showPassingHint, setShowPassingHint] = useState(true)
  const [lastCreatedLesson, setLastCreatedLesson] = useState<CreatedLessonState | null>(null)
  const [sourceLessonApplied, setSourceLessonApplied] = useState(false)

  const steps = useMemo(() => getSteps(features.quiz), [features.quiz])
  const currentStepMeta = steps[currentStep]

  const selectedModule = useMemo(
    () => moduleOptions.find(module => String(module.id) === selectedModuleId) || moduleOptions[0] || null,
    [moduleOptions, selectedModuleId],
  )
  const selectedClass = useMemo(
    () => targetConfig.kind === 'classroom'
      ? targetConfig.classes.find(item => item.id === selectedClassId) || null
      : null,
    [selectedClassId, targetConfig],
  )
  const orderedLessons = useMemo(
    () => [...(selectedModule?.lessons || [])].sort((left, right) => {
      if (left.order_index !== right.order_index) return left.order_index - right.order_index
      return left.id - right.id
    }),
    [selectedModule],
  )
  const roadmapVisible = Boolean(
    mode === 'admin'
    && selectedModule
    && (selectedModule.is_published || publishModuleIfNeeded),
  )
  const isAdminMode = mode === 'admin'
  const quizPayload = useMemo(() => buildQuizPayload(form), [form])
  const completedSteps = useMemo(
    () => steps.filter(step => stepComplete(step.id, form, features.quiz)).length,
    [features.quiz, form, steps],
  )
  const progressPercent = Math.round((completedSteps / Math.max(steps.length, 1)) * 100)

  useEffect(() => {
    setCurrentStep(current => Math.min(current, steps.length - 1))
  }, [steps.length])

  useEffect(() => {
    if (targetConfig.kind !== 'module') return

    if (!moduleOptions.length) {
      setSelectedModuleId('')
      setInsertPosition('1')
      const resetForm = createInitialLessonBuilderForm('middle')
      setForm(manualCheckAvailable ? resetForm : { ...resetForm, checkMode: 'keywords' })
      return
    }

    if (!moduleOptions.some(module => String(module.id) === selectedModuleId)) {
      setSelectedModuleId(String(moduleOptions[0].id))
      setInsertPosition(String(moduleOptions[0].lessons.length + 1))
    }
  }, [moduleOptions, selectedModuleId, targetConfig.kind])

  useEffect(() => {
    if (targetConfig.kind !== 'module' || !selectedModule) return

    const nextAgeGroup = normalizeAgeGroup(selectedModule.age_group)
    const nextLanguage = defaultLanguageForAgeGroup(nextAgeGroup)

    setForm(current => {
      const nextPracticeFormat = !ageGroupSupportsCode(nextAgeGroup) && current.practiceFormat === 'code'
        ? 'text'
        : current.practiceFormat
      const nextCheckMode = nextPracticeFormat === 'code'
        ? 'tests'
        : current.checkMode === 'tests'
          ? textCheckFallback
          : !manualCheckAvailable && current.checkMode === 'manual'
            ? 'keywords'
          : current.checkMode

      if (
        current.ageGroup === nextAgeGroup
        && current.programmingLanguage === nextLanguage
        && current.practiceFormat === nextPracticeFormat
        && current.checkMode === nextCheckMode
      ) {
        return current
      }

      return {
        ...current,
        ageGroup: nextAgeGroup,
        programmingLanguage: nextLanguage,
        practiceFormat: nextPracticeFormat,
        checkMode: nextCheckMode,
      }
    })
  }, [manualCheckAvailable, selectedModule, targetConfig.kind, textCheckFallback])

  useEffect(() => {
    if (form.ageGroup === 'junior' && form.practiceFormat === 'code') {
      setForm(current => ({
        ...current,
        practiceFormat: 'text',
        checkMode: current.checkMode === 'tests' ? textCheckFallback : current.checkMode,
        programmingLanguage: defaultLanguageForAgeGroup('junior'),
      }))
    }
  }, [form.ageGroup, form.practiceFormat, form.checkMode, textCheckFallback])

  useEffect(() => {
    if (!manualCheckAvailable && form.checkMode === 'manual') {
      setForm(current => ({ ...current, checkMode: 'keywords' }))
      return
    }

    if (form.practiceFormat === 'none') {
      setForm(current =>
        current.checkMode === textCheckFallback ? current : { ...current, checkMode: textCheckFallback },
      )
      return
    }

    if (form.practiceFormat === 'text' && form.checkMode === 'tests') {
      setForm(current => ({ ...current, checkMode: textCheckFallback }))
      return
    }

    if (form.practiceFormat === 'code' && form.checkMode !== 'tests') {
      setForm(current => ({ ...current, checkMode: 'tests' }))
    }
  }, [form.practiceFormat, form.checkMode, manualCheckAvailable, textCheckFallback])

  useEffect(() => {
    if (!features.drafts || targetConfig.kind !== 'classroom') return

    const draftKey = targetConfig.draftKey || 'progyx_teacher_lesson_builder_v2'
    try {
      const rawDraft = window.localStorage.getItem(draftKey)
      if (!rawDraft) return
      const parsed = JSON.parse(rawDraft) as unknown
      if (!ensureDraftShape(parsed)) return

      setForm({ ...createInitialLessonBuilderForm(parsed.form.ageGroup), ...parsed.form })
      setCurrentStep(Math.min(Math.max(parsed.currentStep, 0), steps.length - 1))
      if (typeof parsed.selectedClassId === 'number') {
        setSelectedClassId(parsed.selectedClassId)
      }
      showInfoToast('Черновик восстановлен. Можно продолжить с того же шага.')
    } catch {
      window.localStorage.removeItem(draftKey)
    }
  }, [features.drafts, steps.length, targetConfig])

  useEffect(() => {
    if (
      targetConfig.kind !== 'classroom'
      || !features.sourcePrefill
      || !selectedClassId
    ) {
      if (targetConfig.kind === 'classroom') {
        setCatalog([])
      }
      return
    }

    let cancelled = false
    setCatalogLoading(true)

    api<{ lessons: LessonCatalogItem[] }>(
      `/teacher/lesson-catalog?classroom_id=${selectedClassId}`,
      undefined,
      'required',
    )
      .then(result => {
        if (!cancelled) {
          setCatalog(result.lessons)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog([])
          showErrorToast('Не удалось загрузить библиотеку уроков выбранного класса.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCatalogLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [features.sourcePrefill, selectedClassId, targetConfig])

  useEffect(() => {
    if (
      targetConfig.kind !== 'classroom'
      || !features.sourcePrefill
      || !targetConfig.sourceLessonId
      || sourceLessonApplied
      || catalogLoading
    ) {
      return
    }

    const sourceLesson = catalog.find(lesson => lesson.id === targetConfig.sourceLessonId)
    if (!sourceLesson) return

    const nextAgeGroup = normalizeAgeGroup(sourceLesson.module_age_group)
    setForm(current => ({
      ...current,
      title: sourceLesson.title,
      summary: sourceLesson.summary,
      ageGroup: nextAgeGroup,
      duration: String(sourceLesson.duration_minutes),
      passingScore: String(sourceLesson.passing_score),
      programmingLanguage: defaultLanguageForAgeGroup(nextAgeGroup),
    }))
    setSourceLessonApplied(true)
    showInfoToast(`Черновик заполнен на основе урока «${sourceLesson.title}».`)
  }, [catalog, catalogLoading, features.sourcePrefill, sourceLessonApplied, targetConfig])

  function updateForm<K extends keyof LessonBuilderForm>(field: K, value: LessonBuilderForm[K]) {
    setForm(current => ({
      ...current,
      [field]: value,
    }))
  }

  function saveDraft() {
    if (!features.drafts || targetConfig.kind !== 'classroom') return
    const draftKey = targetConfig.draftKey || 'progyx_teacher_lesson_builder_v2'
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({ form, currentStep, selectedClassId }),
    )
    showSuccessToast('Черновик сохранен на этом устройстве.')
  }

  function resetFormForCurrentContext(nextInsert = insertPosition) {
    const nextAgeGroup = selectedModule
      ? normalizeAgeGroup(selectedModule.age_group)
      : form.ageGroup

    setForm(createInitialLessonBuilderForm(nextAgeGroup))
    if (mode === 'admin') {
      setInsertPosition(nextInsert)
    }
  }

  function handleModuleChange(nextModuleId: string) {
    setSelectedModuleId(nextModuleId)
    const nextModule = moduleOptions.find(module => String(module.id) === nextModuleId) || null
    setInsertPosition(nextModule ? String(nextModule.lessons.length + 1) : '1')
  }

  function addJudgeTest() {
    setForm(current => ({
      ...current,
      judgeTests: [...current.judgeTests, createEmptyTest()],
    }))
  }

  function updateJudgeTest(index: number, patch: Partial<JudgeTestCase>) {
    setForm(current => ({
      ...current,
      judgeTests: current.judgeTests.map((testCase, testIndex) => (
        testIndex === index ? { ...testCase, ...patch } : testCase
      )),
    }))
  }

  function removeJudgeTest(index: number) {
    setForm(current => ({
      ...current,
      judgeTests: current.judgeTests.filter((_, testIndex) => testIndex !== index),
    }))
  }

  function addQuizQuestion(type: QuizQuestionType) {
    setForm(current => ({
      ...current,
      quizEnabled: true,
      quizQuestions: [...current.quizQuestions, createQuizQuestion(type)],
    }))
  }

  function updateQuizQuestion(index: number, patch: Partial<QuizQuestionDraft>) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, questionIndex) => (
        questionIndex === index ? { ...question, ...patch } : question
      )),
    }))
  }

  function replaceQuizQuestion(index: number, nextQuestion: QuizQuestionDraft) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, questionIndex) => (
        questionIndex === index ? nextQuestion : question
      )),
    }))
  }

  function removeQuizQuestion(index: number) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.filter((_, questionIndex) => questionIndex !== index),
    }))
  }

  function addQuestionOption(questionIndex: number) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, index) => (
        index === questionIndex
          ? { ...question, options: [...question.options, createChoiceOption()] }
          : question
      )),
    }))
  }

  function updateQuestionOption(questionIndex: number, optionId: string, patch: { text?: string; correct?: boolean }) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, index) => (
        index === questionIndex
          ? {
            ...question,
            options: question.options.map(option => (
              option.id === optionId ? { ...option, ...patch } : option
            )),
          }
          : question
      )),
    }))
  }

  function toggleCorrectOption(questionIndex: number, optionId: string) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, index) => {
        if (index !== questionIndex) return question
        return {
          ...question,
          options: question.options.map(option => (
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
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, index) => (
        index === questionIndex
          ? { ...question, options: question.options.filter(option => option.id !== optionId) }
          : question
      )),
    }))
  }

  function addMatchPair(questionIndex: number) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, index) => (
        index === questionIndex
          ? { ...question, pairs: [...question.pairs, createMatchPair()] }
          : question
      )),
    }))
  }

  function updateMatchPair(questionIndex: number, pairId: string, patch: Partial<MatchPairDraft>) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, index) => (
        index === questionIndex
          ? {
            ...question,
            pairs: question.pairs.map(pair => (
              pair.id === pairId ? { ...pair, ...patch } : pair
            )),
          }
          : question
      )),
    }))
  }

  function removeMatchPair(questionIndex: number, pairId: string) {
    setForm(current => ({
      ...current,
      quizQuestions: current.quizQuestions.map((question, index) => (
        index === questionIndex
          ? { ...question, pairs: question.pairs.filter(pair => pair.id !== pairId) }
          : question
      )),
    }))
  }

  async function handleCreateLesson() {
    if (targetConfig.kind === 'classroom' && !selectedClassId) {
      showInfoToast('Выберите класс, в котором нужно сохранить урок.')
      return
    }

    if (targetConfig.kind === 'module' && !selectedModule) {
      showInfoToast('Сначала создайте хотя бы один обычный модуль для уроков.')
      return
    }

    if (!stepComplete('confirm', form, features.quiz)) {
      showInfoToast('Перед созданием урока заполните обязательные поля предыдущих шагов.')
      return
    }

    if (form.ageGroup === 'junior' && form.practiceFormat === 'code') {
      showInfoToast('Для Junior-уроков кодовая практика недоступна. Выберите текстовое задание.')
      return
    }

    if (
      form.practiceFormat === 'text'
      && hasExplicitCodeTaskIntent({
        title: form.taskTitle,
        prompt: form.taskPrompt,
        starterCode: form.starterCode,
      })
    ) {
      showInfoToast('Похоже, это кодовая практика. Переключите формат практики на кодовую и добавьте автотесты.')
      return
    }

    if (form.practiceFormat === 'code' && !hasCompleteJudgeTest(form.judgeTests)) {
      showInfoToast('Для кодовой практики нужен хотя бы один автотест с входными данными и ожидаемым результатом.')
      return
    }

    if (form.practiceFormat === 'text' && form.checkMode === 'keywords' && !form.answerKeywords.trim()) {
      showInfoToast('Для автопроверки по ключевым словам добавьте ориентиры ответа.')
      return
    }

    if (features.quiz && form.quizEnabled) {
      if (quizPayload.error) {
        showInfoToast(quizPayload.error)
        return
      }
      if (quizPayload.questions.length === 0) {
        showInfoToast('Добавьте хотя бы один вопрос в итоговый квиз.')
        return
      }
    }

    const lesson = buildLessonSubmitData(form)
    const target = targetConfig.kind === 'classroom'
      ? { kind: 'classroom' as const, classroomId: selectedClassId! as number }
      : {
        kind: 'module' as const,
        moduleId: selectedModule!.id,
        insertPosition: Number(insertPosition || orderedLessons.length + 1),
        publishModuleIfNeeded,
      }

    try {
      setCreatingLesson(true)
      const result = await submitLesson({ target, lesson })
      setLastCreatedLesson(result.lesson)

      if (mode === 'admin') {
        resetFormForCurrentContext(result.nextInsertPosition || insertPosition)
      } else if (features.drafts && targetConfig.kind === 'classroom') {
        window.localStorage.removeItem(targetConfig.draftKey || 'progyx_teacher_lesson_builder_v2')
      }

      await onCreated?.(result)
      showSuccessToast(result.successMessage)
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Не удалось создать урок.')
    } finally {
      setCreatingLesson(false)
    }
  }

  function goNext() {
    if (!stepComplete(currentStepMeta.id, form, features.quiz)) {
      showInfoToast('Заполните обязательные поля текущего шага, чтобы перейти дальше.')
      return
    }

    if (currentStep === steps.length - 1) {
      void handleCreateLesson()
      return
    }

    setCurrentStep(step => Math.min(step + 1, steps.length - 1))
  }

  function goBack() {
    setCurrentStep(step => Math.max(step - 1, 0))
  }

  function renderTargetSection() {
    if (targetConfig.kind === 'classroom') {
      const hasNoClasses = targetConfig.classes.length === 0

      return (
        <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]'>
          <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4'>
            <p className='text-sm font-semibold text-slate-900'>Куда сохранить урок</p>
            {hasNoClasses ? (
              <div className='mt-4 flex min-h-[11rem] flex-col justify-between rounded-[20px] border border-dashed border-sky-100 bg-sky-50 p-5'>
                <div className='space-y-2'>
                  <p className='text-base font-semibold text-slate-900'>Сначала создайте класс</p>
                  <p className='max-w-md text-sm leading-6 text-slate-600'>
                    Без класса урок некуда сохранить. Создайте класс в кабинете учителя, затем можно будет вернуться к уроку.
                  </p>
                </div>
                <Link
                  href={targetConfig.createTargetHref || '/teacher'}
                  className='mt-4 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-700'
                >
                  Создать класс
                  <ArrowRight className='h-4 w-4' />
                </Link>
              </div>
            ) : (
              <p className='mt-3 max-w-md text-sm leading-6 text-slate-600'>
                Выберите класс справа, и урок сохранится в его библиотеке.
              </p>
            )}
          </div>
          <div className='rounded-[24px] border border-slate-200 bg-white/90 p-4'>
            <label className='text-sm font-semibold text-slate-900'>Класс для сохранения</label>
            <select
              disabled={hasNoClasses}
              className={clsx(
                'mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100',
                hasNoClasses && 'cursor-not-allowed bg-slate-50 text-slate-500',
              )}
              value={selectedClassId ?? ''}
              onChange={event => setSelectedClassId(event.target.value ? Number(event.target.value) : null)}
            >
              {hasNoClasses ? <option value=''>Нет доступных классов</option> : null}
              {targetConfig.classes.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <p className='mt-2 text-xs leading-5 text-slate-500'>
              {selectedClass
                ? `Урок будет создан в библиотеке класса «${selectedClass.name}».`
                : 'Сначала создайте или выберите класс в кабинете учителя.'}
            </p>
          </div>
        </div>
      )
    }

    if (!moduleOptions.length) {
      return (
        <div className='rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600'>
          Сначала создайте обычный модуль в соседней секции админки. После этого сюда можно будет добавить roadmap-урок, практику и итоговый квиз.
        </div>
      )
    }

    return (
      <div className='grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]'>
        <div className='order-2 rounded-[28px] border border-slate-200 bg-slate-50/80 p-5 sm:p-6 xl:order-1'>
          <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
            <div className='min-w-0'>
              <p className='text-sm font-semibold text-slate-900'>Куда сохранить урок</p>
              <p className='mt-3 max-w-2xl text-sm leading-6 text-slate-600'>
                Выберите roadmap-модуль, задайте точку вставки и решите, нужно ли сразу открыть модуль для учеников.
              </p>
            </div>
            <span
              className={clsx(
                'inline-flex w-fit shrink-0 rounded-full px-3 py-2 text-xs font-semibold',
                roadmapVisible ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700',
              )}
            >
              {roadmapVisible ? 'Будет в уроках' : 'Скрыт до публикации'}
            </span>
          </div>

          <div className='mt-5 grid gap-3 sm:grid-cols-3'>
            <div className='rounded-[22px] border border-slate-200 bg-white px-4 py-4'>
              <p className='text-xs font-semibold uppercase tracking-[0.16em] text-slate-400'>Модуль</p>
              <p className='mt-2 break-words text-sm font-semibold text-slate-900'>{selectedModule?.title}</p>
            </div>
            <div className='rounded-[22px] border border-slate-200 bg-white px-4 py-4'>
              <p className='text-xs font-semibold uppercase tracking-[0.16em] text-slate-400'>Возраст</p>
              <p className='mt-2 text-sm font-semibold text-slate-900'>{selectedModule?.age_group}</p>
            </div>
            <div className='rounded-[22px] border border-slate-200 bg-white px-4 py-4'>
              <p className='text-xs font-semibold uppercase tracking-[0.16em] text-slate-400'>Позиция</p>
              <p className='mt-2 text-sm font-semibold text-slate-900'>№ {insertPosition}</p>
            </div>
          </div>
        </div>

        <div className='order-1 rounded-[28px] border border-slate-200 bg-white/95 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] sm:p-6 xl:order-2'>
          <div className='grid gap-4 lg:grid-cols-2'>
            <div>
              <label className='text-sm font-semibold text-slate-900'>Модуль</label>
              <select
                className='mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                value={selectedModuleId}
                onChange={event => handleModuleChange(event.target.value)}
              >
                {moduleOptions.map(module => (
                  <option key={module.id} value={module.id}>
                    {module.title} ({module.age_group})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className='text-sm font-semibold text-slate-900'>Позиция в модуле</label>
              <select
                className='mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                value={insertPosition}
                onChange={event => setInsertPosition(event.target.value)}
              >
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
          </div>

          {features.publishToggle ? (
            <label className='mt-4 flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700'>
              <input
                type='checkbox'
                className='mt-1 h-4 w-4 shrink-0'
                checked={publishModuleIfNeeded}
                onChange={event => setPublishModuleIfNeeded(event.target.checked)}
              />
              <span className='min-w-0'>
                Если модуль еще не опубликован, сразу открыть его для уроков.
                <span className='mt-1 block text-xs text-slate-500'>
                  Сейчас модуль {selectedModule?.is_published ? 'уже опубликован' : 'скрыт от учеников'}.
                </span>
              </span>
            </label>
          ) : null}
        </div>
      </div>
    )
  }

  function renderFoundationStep() {
    return (
      <div className='space-y-6'>
        <header className='space-y-2'>
          <h2 className='text-[clamp(1.5rem,3vw,1.9rem)] font-bold text-slate-900'>Шаг 1. Основная информация</h2>
          <p className='max-w-3xl text-sm leading-6 text-slate-600 md:text-base'>
            Сначала задайте базовые параметры урока: тему, аудиторию, длительность и ожидаемый результат.
          </p>
        </header>

        <div className='grid gap-5'>
          <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
            <LabelBlock label='Название урока' required />
            <input
              className='mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
              placeholder='Например: Переменные и условия'
              value={form.title}
              onChange={event => updateForm('title', event.target.value)}
            />
          </div>

          {mode === 'teacher' ? (
            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Для кого урок' required />
              <div className='mt-3 grid gap-3 sm:grid-cols-3'>
                {AGE_GROUP_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type='button'
                    className={clsx(
                      'rounded-2xl border px-4 py-3 text-left transition',
                      form.ageGroup === option.value
                        ? 'border-sky-600 bg-sky-600 text-white shadow-[0_14px_30px_rgba(2,132,199,0.25)]'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                    )}
                    onClick={() => updateForm('ageGroup', option.value)}
                  >
                    <div className='flex items-center justify-between gap-3'>
                      <span className='text-base font-semibold'>{option.label}</span>
                      {form.ageGroup === option.value ? <Check className='h-4 w-4' /> : null}
                    </div>
                    <p
                      className={clsx(
                        'mt-2 text-sm leading-5',
                        form.ageGroup === option.value ? 'text-sky-50/90' : 'text-slate-500',
                      )}
                    >
                      {option.hint}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Возрастная группа' required />
              <div className='mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-700'>
                Для roadmap-урока возрастная группа берется из выбранного модуля.
                <span className='mt-2 block text-base font-semibold text-slate-900'>
                  {AGE_GROUP_OPTIONS.find(option => option.value === form.ageGroup)?.label || form.ageGroup}
                </span>
              </div>
            </div>
          )}

          <div className='grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]'>
            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Длительность урока' required />
              <div className='mt-3 flex items-center gap-3'>
                <input
                  className='w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                  value={form.duration}
                  onChange={event => updateForm('duration', event.target.value.replace(/[^\d]/g, ''))}
                />
                <span className='rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-500'>мин</span>
              </div>
            </div>

            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Краткое описание' required />
              <textarea
                className='mt-3 min-h-[124px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                placeholder='В 1–2 предложениях: что ученик поймет или чему научится.'
                value={form.summary}
                onChange={event => updateForm('summary', event.target.value)}
              />
            </div>
          </div>

          <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
            <LabelBlock label='Минимальный результат для прохождения' required />
            <div className='mt-3 flex flex-wrap items-center gap-3'>
              <div className='inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-3'>
                <input
                  className='w-14 border-none bg-transparent text-base font-semibold text-slate-900 outline-none'
                  value={form.passingScore}
                  onChange={event => updateForm('passingScore', event.target.value.replace(/[^\d]/g, ''))}
                />
                <span className='text-base font-semibold text-slate-500'>%</span>
              </div>
              {!showPassingHint ? (
                <button
                  type='button'
                  className='inline-flex items-center gap-2 text-sm font-medium text-sky-700'
                  onClick={() => setShowPassingHint(true)}
                >
                  Показать пояснение
                </button>
              ) : null}
            </div>

            {showPassingHint ? (
              <div className='mt-4 rounded-[24px] border border-sky-100 bg-white p-5 shadow-[0_16px_40px_rgba(2,132,199,0.1)]'>
                <h3 className='text-lg font-semibold text-slate-900'>Что значит порог успешного прохождения?</h3>
                <p className='mt-3 text-sm leading-7 text-slate-600 md:text-base'>
                  Это минимальный процент, который нужно набрать, чтобы урок считался успешно завершенным.
                </p>
                <div className='mt-4 flex justify-end'>
                  <button
                    type='button'
                    className='inline-flex min-h-11 items-center justify-center rounded-full bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-700'
                    onClick={() => setShowPassingHint(false)}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  function renderFormatStep() {
    return (
      <div className='space-y-6'>
        <header className='space-y-2'>
          <h2 className='text-[clamp(1.45rem,3vw,1.85rem)] font-bold text-slate-900'>Шаг 2. Формат урока</h2>
          <p className='max-w-3xl text-sm leading-6 text-slate-600 md:text-base'>
            Выберите, как именно будет идти урок: через разбор, тренировку навыка, мини-проект или повторение.
          </p>
        </header>

        <div className='grid gap-4 lg:grid-cols-2'>
          {LESSON_FORMAT_OPTIONS.map(option => (
            <button
              key={option.value}
              type='button'
              className={clsx(
                'rounded-[24px] border p-5 text-left transition',
                form.lessonFormat === option.value
                  ? 'border-sky-600 bg-white shadow-[0_20px_45px_rgba(2,132,199,0.12)]'
                  : 'border-slate-200 bg-slate-50/70 hover:border-slate-300',
              )}
              onClick={() => updateForm('lessonFormat', option.value)}
            >
              <div className='flex items-start justify-between gap-3'>
                <h3 className='text-lg font-semibold text-slate-900'>{option.label}</h3>
                {form.lessonFormat === option.value ? (
                  <span className='inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-white'>
                    <Check className='h-4 w-4' />
                  </span>
                ) : null}
              </div>
              <p className='mt-3 text-sm leading-6 text-slate-600'>{option.description}</p>
            </button>
          ))}
        </div>

        <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
          <LabelBlock label='Методическая пометка' />
          <textarea
            className='mt-3 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
            placeholder='Например: сначала жизненный пример, затем объяснение и короткая практика в конце.'
            value={form.formatNote}
            onChange={event => updateForm('formatNote', event.target.value)}
          />
        </div>
      </div>
    )
  }

  function renderContentStep() {
    return (
      <div className='space-y-6'>
        <header className='space-y-2'>
          <h2 className='text-[clamp(1.45rem,3vw,1.85rem)] font-bold text-slate-900'>Шаг 3. Содержание</h2>
          <p className='max-w-3xl text-sm leading-6 text-slate-600 md:text-base'>
            Добавьте объяснение, ключевые идеи и маршрут прохождения урока, чтобы ученик понимал логику движения.
          </p>
        </header>

        <div className='space-y-5'>
          <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
            <LabelBlock label='Объяснение темы' required />
            <textarea
              className='mt-3 min-h-[180px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
              placeholder='Объясните тему простым языком: от примера к правилу и затем к выводу.'
              value={form.theoryText}
              onChange={event => updateForm('theoryText', event.target.value)}
            />
          </div>

          <div className='grid gap-5 lg:grid-cols-2'>
            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Ключевые идеи' required />
              <textarea
                className='mt-3 min-h-[170px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                placeholder={'Каждая идея с новой строки.\nНапример:\nЧто такое переменная\nКак работает условие'}
                value={form.keyPoints}
                onChange={event => updateForm('keyPoints', event.target.value)}
              />
            </div>

            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Маршрут урока' required />
              <textarea
                className='mt-3 min-h-[170px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                placeholder={'Каждый шаг с новой строки.\nНапример:\nПоказать пример\nРазобрать условие\nПодвести итог'}
                value={form.interactiveSteps}
                onChange={event => updateForm('interactiveSteps', event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderPracticeStep() {
    const supportsCode = ageGroupSupportsCode(form.ageGroup)

    return (
      <div className='space-y-6'>
        <header className='space-y-2'>
          <h2 className='text-[clamp(1.45rem,3vw,1.85rem)] font-bold text-slate-900'>Шаг 4. Практика</h2>
          <p className='max-w-3xl text-sm leading-6 text-slate-600 md:text-base'>
            Решите, нужна ли встроенная практика, и выберите формат практического задания без лишнего перегруза.
          </p>
        </header>

        <div className='grid gap-4 lg:grid-cols-3'>
          {PRACTICE_OPTIONS.map(option => (
            <button
              key={option.value}
              type='button'
              disabled={option.value === 'code' && !supportsCode}
              className={clsx(
                'rounded-[24px] border p-5 text-left transition',
                option.value === 'code' && !supportsCode && 'cursor-not-allowed opacity-55',
                form.practiceFormat === option.value
                  ? 'border-sky-600 bg-white shadow-[0_20px_45px_rgba(2,132,199,0.12)]'
                  : 'border-slate-200 bg-slate-50/70 hover:border-slate-300',
              )}
              onClick={() => updateForm('practiceFormat', option.value)}
            >
              <div className='flex items-start justify-between gap-3'>
                <h3 className='text-lg font-semibold text-slate-900'>{option.label}</h3>
                {form.practiceFormat === option.value ? (
                  <span className='inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-white'>
                    <Check className='h-4 w-4' />
                  </span>
                ) : null}
              </div>
              <p className='mt-3 text-sm leading-6 text-slate-600'>{option.description}</p>
              {option.value === 'code' && !supportsCode ? (
                <p className='mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400'>
                  Для Junior недоступно
                </p>
              ) : null}
            </button>
          ))}
        </div>

        {form.practiceFormat === 'none' ? (
          <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-5 text-sm leading-7 text-slate-600'>
            Практика не добавлена в сам урок. После создания урок можно будет отдельно использовать в нужном сценарии позже.
          </div>
        ) : (
          <div className='space-y-5'>
            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Название практики' required />
              <input
                className='mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                placeholder='Например: Мини-практика по условиям'
                value={form.taskTitle}
                onChange={event => updateForm('taskTitle', event.target.value)}
              />
            </div>

            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Формулировка задания' required />
              <textarea
                className='mt-3 min-h-[160px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                placeholder='Опишите, что именно должен сделать ученик и какой результат ожидается.'
                value={form.taskPrompt}
                onChange={event => updateForm('taskPrompt', event.target.value)}
              />
            </div>

            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Подсказки для ученика' />
              <textarea
                className='mt-3 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                placeholder={'Каждая подсказка с новой строки.\nНапример:\nСначала выдели условие\nПроверь результат на простом примере'}
                value={form.taskHints}
                onChange={event => updateForm('taskHints', event.target.value)}
              />
            </div>

            {form.practiceFormat === 'code' ? (
              <div className='grid gap-5 lg:grid-cols-[minmax(0,0.48fr)_minmax(0,1fr)]'>
                <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                  <LabelBlock label='Язык задания' required />
                  <div className='mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1'>
                    {(['python', 'javascript'] as const).map(language => (
                      <button
                        key={language}
                        type='button'
                        className={clsx(
                          'rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition',
                          form.programmingLanguage === language
                            ? 'border-sky-600 bg-sky-600 text-white'
                            : 'border-slate-200 bg-white text-slate-700',
                        )}
                        onClick={() => updateForm('programmingLanguage', language)}
                      >
                        {language === 'python' ? 'Python' : 'JavaScript'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                  <LabelBlock label='Стартовый код' required />
                  <textarea
                    className='mt-3 min-h-[220px] w-full rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                    placeholder={'def solve():\n    pass'}
                    value={form.starterCode}
                    onChange={event => updateForm('starterCode', event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  function renderCheckStep() {
    return (
      <div className='space-y-6'>
        <header className='space-y-2'>
          <h2 className='text-[clamp(1.45rem,3vw,1.85rem)] font-bold text-slate-900'>Шаг 5. Проверка</h2>
          <p className='max-w-3xl text-sm leading-6 text-slate-600 md:text-base'>
            {manualCheckAvailable
              ? 'Выберите, как проверять ответ: вручную, по ключевым словам или автотестами.'
              : 'Выберите автоматический способ проверки: по ключевым словам или автотестами.'}
          </p>
        </header>

        {form.practiceFormat === 'none' ? (
          <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-5 text-sm leading-7 text-slate-600'>
            Встроенная практика не выбрана, поэтому отдельная проверка на этом шаге не требуется.
          </div>
        ) : (
          <>
            <div className='grid gap-4 lg:grid-cols-3'>
              {CHECK_OPTIONS.filter(option =>
                form.practiceFormat === 'code'
                  ? option.value === 'tests'
                  : option.value !== 'tests' && (manualCheckAvailable || option.value !== 'manual'),
              ).map(option => (
                <button
                  key={option.value}
                  type='button'
                  className={clsx(
                    'rounded-[24px] border p-5 text-left transition',
                    form.checkMode === option.value
                      ? 'border-sky-600 bg-white shadow-[0_20px_45px_rgba(2,132,199,0.12)]'
                      : 'border-slate-200 bg-slate-50/70 hover:border-slate-300',
                  )}
                  onClick={() => updateForm('checkMode', option.value)}
                >
                  <div className='flex items-start justify-between gap-3'>
                    <h3 className='text-lg font-semibold text-slate-900'>{option.label}</h3>
                    {form.checkMode === option.value ? (
                      <span className='inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-white'>
                        <Check className='h-4 w-4' />
                      </span>
                    ) : null}
                  </div>
                  <p className='mt-3 text-sm leading-6 text-slate-600'>{option.description}</p>
                </button>
              ))}
            </div>

            {manualCheckAvailable && form.checkMode === 'manual' ? (
              <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-5 text-sm leading-7 text-slate-600'>
                Это самый безопасный режим для открытых ответов и рассуждений. Итог подтверждается вручную.
              </div>
            ) : null}

            {form.checkMode === 'keywords' ? (
              <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                <LabelBlock label='Ключевые слова для автопроверки' required />
                <textarea
                  className='mt-3 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                  placeholder='Например: переменная, условие, ветвление'
                  value={form.answerKeywords}
                  onChange={event => updateForm('answerKeywords', event.target.value)}
                />
              </div>
            ) : null}

            {form.checkMode === 'tests' ? (
              <div className='space-y-4'>
                <div className='grid gap-5 lg:grid-cols-[minmax(0,0.34fr)_minmax(0,0.34fr)_minmax(0,0.32fr)]'>
                  <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                    <LabelBlock label='Тайм-лимит' required />
                    <div className='mt-3 flex items-center gap-3'>
                      <input
                        className='w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                        value={form.timeLimitMs}
                        onChange={event => updateForm('timeLimitMs', event.target.value.replace(/[^\d]/g, ''))}
                      />
                      <span className='rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-500'>мс</span>
                    </div>
                  </div>

                  <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                    <LabelBlock label='Память' required />
                    <div className='mt-3 flex items-center gap-3'>
                      <input
                        className='w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                        value={form.memoryLimitMb}
                        onChange={event => updateForm('memoryLimitMb', event.target.value.replace(/[^\d]/g, ''))}
                      />
                      <span className='rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-500'>MB</span>
                    </div>
                  </div>

                  <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                    <LabelBlock label='Рекомендация' />
                    <p className='mt-3 text-sm leading-6 text-slate-600'>
                      Для первого релиза урока обычно достаточно 2–3 тестов: базовый, граничный и один на типичную ошибку.
                    </p>
                  </div>
                </div>

                {form.judgeTests.map((testCase, index) => (
                  <div key={`test-${index}`} className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                    <div className='flex items-center justify-between gap-3'>
                      <h3 className='text-base font-semibold text-slate-900'>Тест {index + 1}</h3>
                      {form.judgeTests.length > 1 ? (
                        <button
                          type='button'
                          className='inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600'
                          onClick={() => removeJudgeTest(index)}
                        >
                          Удалить
                        </button>
                      ) : null}
                    </div>
                    <div className='mt-4 grid gap-4 lg:grid-cols-2'>
                      <div>
                        <LabelBlock label='Входные данные' required />
                        <textarea
                          className='mt-3 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                          value={testCase.input}
                          onChange={event => updateJudgeTest(index, { input: event.target.value })}
                        />
                      </div>
                      <div>
                        <LabelBlock label='Ожидаемый результат' required />
                        <textarea
                          className='mt-3 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                          value={testCase.expected}
                          onChange={event => updateJudgeTest(index, { expected: event.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type='button'
                  className='inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700'
                  onClick={addJudgeTest}
                >
                  Добавить тест
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    )
  }

  function renderQuizQuestionEditor(question: QuizQuestionDraft, questionIndex: number) {
    const typeMeta = QUIZ_TYPE_OPTIONS.find(option => option.value === question.type)

    return (
      <div key={question.id} className='rounded-[24px] border border-slate-200 bg-slate-50 p-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <p className='text-xs font-bold uppercase tracking-[0.16em] text-slate-500'>Вопрос {questionIndex + 1}</p>
            <p className='mt-2 text-lg font-black text-slate-900'>{typeMeta?.label}</p>
            <p className='mt-1 text-sm text-slate-600'>{typeMeta?.short}</p>
          </div>
          <div className='flex flex-wrap gap-2'>
            <select
              className='rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700'
              value={question.type}
              onChange={event => replaceQuizQuestion(questionIndex, createQuizQuestion(event.target.value as QuizQuestionType))}
            >
              {QUIZ_TYPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              type='button'
              onClick={() => removeQuizQuestion(questionIndex)}
              className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700'
            >
              Удалить
            </button>
          </div>
        </div>

        <textarea
          className='mt-4 min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3'
          placeholder='Текст вопроса'
          value={question.prompt}
          onChange={event => updateQuizQuestion(questionIndex, { prompt: event.target.value })}
        />

        {(question.type === 'single' || question.type === 'multiple') ? (
          <div className='mt-4 space-y-3'>
            {question.options.map(option => (
              <div key={option.id} className='grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center'>
                <button
                  type='button'
                  onClick={() => toggleCorrectOption(questionIndex, option.id)}
                  className={clsx(
                    'rounded-full px-3 py-2 text-xs font-bold',
                    option.correct ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
                  )}
                >
                  {question.type === 'single'
                    ? option.correct ? 'Верный' : 'Выбрать'
                    : option.correct ? 'Верный' : 'Отметить'}
                </button>
                <input
                  className='rounded-2xl border border-slate-200 px-4 py-3'
                  placeholder='Текст варианта'
                  value={option.text}
                  onChange={event => updateQuestionOption(questionIndex, option.id, { text: event.target.value })}
                />
                <button
                  type='button'
                  onClick={() => removeQuestionOption(questionIndex, option.id)}
                  className='rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700'
                >
                  Удалить
                </button>
              </div>
            ))}
            <button
              type='button'
              onClick={() => addQuestionOption(questionIndex)}
              className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700'
            >
              Добавить вариант
            </button>
          </div>
        ) : null}

        {question.type === 'order' ? (
          <div className='mt-4 grid gap-3 md:grid-cols-2'>
            <textarea
              className='min-h-28 rounded-2xl border border-slate-200 px-4 py-3'
              placeholder='Шаги в перемешанном порядке, каждый с новой строки'
              value={question.orderItems}
              onChange={event => updateQuizQuestion(questionIndex, { orderItems: event.target.value })}
            />
            <textarea
              className='min-h-28 rounded-2xl border border-slate-200 px-4 py-3'
              placeholder='Правильный порядок, каждый с новой строки'
              value={question.correctOrder}
              onChange={event => updateQuizQuestion(questionIndex, { correctOrder: event.target.value })}
            />
          </div>
        ) : null}

        {question.type === 'match' ? (
          <div className='mt-4 space-y-3'>
            {question.pairs.map(pair => (
              <div key={pair.id} className='grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center'>
                <input
                  className='rounded-2xl border border-slate-200 px-4 py-3'
                  placeholder='Левая колонка'
                  value={pair.left}
                  onChange={event => updateMatchPair(questionIndex, pair.id, { left: event.target.value })}
                />
                <input
                  className='rounded-2xl border border-slate-200 px-4 py-3'
                  placeholder='Правильная пара'
                  value={pair.right}
                  onChange={event => updateMatchPair(questionIndex, pair.id, { right: event.target.value })}
                />
                <button
                  type='button'
                  onClick={() => removeMatchPair(questionIndex, pair.id)}
                  className='rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700'
                >
                  Удалить
                </button>
              </div>
            ))}
            <button
              type='button'
              onClick={() => addMatchPair(questionIndex)}
              className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700'
            >
              Добавить пару
            </button>
          </div>
        ) : null}

        {question.type === 'text' ? (
          <textarea
            className='mt-4 min-h-28 rounded-2xl border border-slate-200 px-4 py-3'
            placeholder='Допустимые ответы, каждый с новой строки'
            value={question.acceptedAnswers}
            onChange={event => updateQuizQuestion(questionIndex, { acceptedAnswers: event.target.value })}
          />
        ) : null}
      </div>
    )
  }

  function renderQuizStep() {
    if (!features.quiz) return null

    const preparedQuestions = form.quizQuestions.filter(questionHasContent).length

    return (
      <div className='space-y-6'>
        <header className='space-y-2'>
          <h2 className='text-[clamp(1.45rem,3vw,1.85rem)] font-bold text-slate-900'>Шаг 6. Итоговый квиз</h2>
          <p className='max-w-3xl text-sm leading-6 text-slate-600 md:text-base'>
            Добавьте короткий контроль по теме: его можно отключить, если сейчас нужен только урок с практикой.
          </p>
        </header>

        <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
          <label className='flex flex-wrap items-start justify-between gap-4'>
            <div className='space-y-2'>
              <LabelBlock label='Квиз в конце урока' />
              <p className='max-w-2xl text-sm leading-6 text-slate-600'>
                Квиз помогает зафиксировать результат. Поддерживаются одиночный и множественный выбор, порядок,
                сопоставление и короткий текстовый ответ.
              </p>
            </div>
            <button
              type='button'
              className={clsx(
                'inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition',
                form.quizEnabled
                  ? 'bg-sky-600 text-white hover:bg-sky-700'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300',
              )}
              onClick={() => updateForm('quizEnabled', !form.quizEnabled)}
            >
              {form.quizEnabled ? 'Квиз включен' : 'Включить квиз'}
            </button>
          </label>
        </div>

        {!form.quizEnabled ? (
          <div className='rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-7 text-slate-600'>
            Урок будет создан без итогового квиза. Если захотите, квиз можно добавить позже через этот же конструктор
            при создании следующего урока.
          </div>
        ) : (
          <>
            <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.42fr)]'>
              <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                <LabelBlock label='Название квиза' required />
                <input
                  className='mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100'
                  placeholder='Например: Проверка по переменным и условиям'
                  value={form.quizTitle}
                  onChange={event => updateForm('quizTitle', event.target.value)}
                />
              </div>

              <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
                <LabelBlock label='Порог прохождения квиза' required />
                <div className='mt-3 flex items-center gap-3'>
                  <div className='inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-3'>
                    <input
                      className='w-14 border-none bg-transparent text-base font-semibold text-slate-900 outline-none'
                      value={form.quizPassingScore}
                      onChange={event => updateForm('quizPassingScore', event.target.value.replace(/[^\d]/g, ''))}
                    />
                    <span className='text-base font-semibold text-slate-500'>%</span>
                  </div>
                  <span className='text-sm text-slate-500'>Обычно хватает 60–80%</span>
                </div>
              </div>
            </div>

            <div className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 sm:p-5'>
              <LabelBlock label='Добавить вопрос' required />
              <div className='mt-4 grid gap-3 lg:grid-cols-5'>
                {QUIZ_TYPE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type='button'
                    className='rounded-[22px] border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-slate-300'
                    onClick={() => addQuizQuestion(option.value)}
                  >
                    <p className='text-base font-semibold text-slate-900'>{option.label}</p>
                    <p className='mt-2 text-sm leading-6 text-slate-600'>{option.short}</p>
                  </button>
                ))}
              </div>
            </div>

            {form.quizQuestions.length ? (
              <div className='space-y-4'>
                {form.quizQuestions.map((question, index) => renderQuizQuestionEditor(question, index))}
              </div>
            ) : (
              <div className='rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-7 text-slate-600'>
                Пока нет ни одного вопроса. Добавьте хотя бы один тип вопроса выше, чтобы урок получил итоговый квиз.
              </div>
            )}

            <div className='lesson-builder__summary rounded-[24px] border border-sky-100 bg-sky-50/70 p-5 text-sm leading-7 text-slate-700'>
              Подготовлено вопросов: <span className='font-semibold text-slate-900'>{preparedQuestions}</span>.
              {quizPayload.error ? (
                <span className='mt-2 block text-rose-700'>{quizPayload.error}</span>
              ) : form.quizQuestions.length ? (
                <span className='mt-2 block text-slate-600'>
                  Перед созданием урока конструктор ещё раз проверит корректность всех вариантов и ответов.
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    )
  }

  function renderConfirmStep() {
    const previewTitle = form.title.trim() || 'Без названия'
    const previewAudience = AGE_GROUP_OPTIONS.find(option => option.value === form.ageGroup)?.label || form.ageGroup
    const previewDuration = `${form.duration || '45'} мин`
    const lessonFormatLabel = LESSON_FORMAT_OPTIONS.find(option => option.value === form.lessonFormat)?.label || 'Не выбран'
    const practiceLabel = PRACTICE_OPTIONS.find(option => option.value === form.practiceFormat)?.label || 'Не выбрано'
    const checkLabel = form.practiceFormat === 'none'
      ? 'Не требуется'
      : CHECK_OPTIONS.find(option => option.value === form.checkMode)?.label || 'Не выбрано'
    const quizLabel = !features.quiz || !form.quizEnabled
      ? 'Квиз не добавлен'
      : form.quizTitle.trim() || `Квиз с ${quizPayload.questions.length} вопросами`

    const checklist = [
      {
        complete: foundationComplete(form),
        done: 'Основные параметры заполнены и понятны ученику.',
        pending: 'Проверьте название, описание и порог прохождения.',
      },
      {
        complete: formatComplete(form),
        done: 'Выбран понятный формат урока.',
        pending: 'Выберите формат урока.',
      },
      {
        complete: contentComplete(form),
        done: 'Есть теория, ключевые идеи и шаги прохождения.',
        pending: 'Добавьте содержание урока.',
      },
      {
        complete: practiceComplete(form),
        done: 'Практика настроена без перегруза.',
        pending: 'Проверьте формат практики.',
      },
      {
        complete: checkComplete(form),
        done: 'Сценарий проверки согласован с форматом задания.',
        pending: 'Уточните, как проверять ответ.',
      },
      ...(features.quiz ? [{
        complete: quizComplete(form, features.quiz),
        done: 'Итоговый квиз готов к публикации.',
        pending: 'Проверьте название, порог и вопросы итогового квиза.',
      }] : []),
    ]

    return (
      <div className='space-y-6'>
        <header className='space-y-2'>
          <h2 className='text-[clamp(1.45rem,3vw,1.85rem)] font-bold text-slate-900'>Шаг 7. Финальная проверка</h2>
          <p className='max-w-3xl text-sm leading-6 text-slate-600 md:text-base'>
            Проверьте, что урок собран полностью и сохраняется в нужный класс или roadmap-модуль.
          </p>
        </header>

        <div className='grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]'>
          <div className='space-y-5'>
            <div className='rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_20px_55px_rgba(15,23,42,0.06)]'>
              <h3 className='text-lg font-semibold text-slate-900'>Что войдет в урок</h3>
              <div className='mt-5 grid gap-4 md:grid-cols-2'>
                <div className='rounded-[22px] border border-slate-200 bg-slate-50/70 p-4'>
                  <p className='text-sm font-medium text-slate-500'>Основа</p>
                  <p className='mt-2 text-base font-semibold text-slate-900'>{previewTitle}</p>
                  <p className='mt-1 text-sm text-slate-600'>Для: {previewAudience}</p>
                  <p className='mt-1 text-sm text-slate-600'>Время: {previewDuration}</p>
                </div>
                <div className='rounded-[22px] border border-slate-200 bg-slate-50/70 p-4'>
                  <p className='text-sm font-medium text-slate-500'>Формат урока</p>
                  <p className='mt-2 text-base font-semibold text-slate-900'>{lessonFormatLabel}</p>
                  <p className='mt-1 text-sm text-slate-600'>
                    {form.formatNote.trim() || 'Дополнительная методическая заметка не добавлена.'}
                  </p>
                </div>
                <div className='rounded-[22px] border border-slate-200 bg-slate-50/70 p-4'>
                  <p className='text-sm font-medium text-slate-500'>Практика</p>
                  <p className='mt-2 text-base font-semibold text-slate-900'>{practiceLabel}</p>
                  <p className='mt-1 text-sm text-slate-600'>
                    {form.practiceFormat === 'none'
                      ? 'Практика вынесена из урока.'
                      : form.taskTitle.trim() || 'Название практики пока не добавлено.'}
                  </p>
                </div>
                <div className='rounded-[22px] border border-slate-200 bg-slate-50/70 p-4'>
                  <p className='text-sm font-medium text-slate-500'>Проверка</p>
                  <p className='mt-2 text-base font-semibold text-slate-900'>{checkLabel}</p>
                  <p className='mt-1 text-sm text-slate-600'>
                    {form.checkMode === 'keywords'
                      ? `Ключевые слова: ${form.answerKeywords || 'не добавлены'}`
                      : form.checkMode === 'tests'
                        ? `Тестов добавлено: ${form.judgeTests.filter(test => test.input.trim() && test.expected.trim()).length}`
                        : 'Учитель подтверждает результат вручную.'}
                  </p>
                </div>
                {features.quiz ? (
                  <div className='rounded-[22px] border border-slate-200 bg-slate-50/70 p-4 md:col-span-2'>
                    <p className='text-sm font-medium text-slate-500'>Итоговый квиз</p>
                    <p className='mt-2 text-base font-semibold text-slate-900'>{quizLabel}</p>
                    <p className='mt-1 text-sm text-slate-600'>
                      {form.quizEnabled
                        ? `Порог: ${form.quizPassingScore || '70'}%. Вопросов: ${quizPayload.questions.length}.`
                        : 'Квиз не требуется для этого урока.'}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className='rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_20px_55px_rgba(15,23,42,0.06)]'>
              <h3 className='text-lg font-semibold text-slate-900'>Куда сохранится урок</h3>
              <div className='mt-5 rounded-[22px] border border-slate-200 bg-slate-50/70 p-4 text-sm leading-7 text-slate-700'>
                {targetConfig.kind === 'classroom'
                  ? selectedClass
                    ? `Урок сохранится в библиотеке класса «${selectedClass.name}». Его можно будет открыть сразу после создания и позже назначить ученикам.`
                    : 'Класс пока не выбран. Сначала создайте или выберите класс.'
                  : selectedModule
                    ? `Урок попадет в модуль «${selectedModule.title}» на позицию ${insertPosition}. ${roadmapVisible ? 'После создания он сразу будет виден в разделе уроков.' : 'Он сохранится, но останется скрытым до публикации модуля.'}`
                    : 'Модуль пока не выбран. Сначала создайте хотя бы один roadmap-модуль.'}
              </div>
            </div>
          </div>

          <div className='rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_20px_55px_rgba(15,23,42,0.06)]'>
            <h3 className='text-lg font-semibold text-slate-900'>Финальный checklist</h3>
            <ul className='mt-5 space-y-3'>
              {checklist.map(item => (
                <li
                  key={item.done}
                  className='flex items-start gap-3 rounded-[22px] border border-slate-200 bg-slate-50/70 px-4 py-3'
                >
                  {item.complete ? (
                    <CheckCircle2 className='mt-0.5 h-5 w-5 shrink-0 text-emerald-600' />
                  ) : (
                    <X className='mt-0.5 h-5 w-5 shrink-0 text-rose-500' />
                  )}
                  <span className='text-sm leading-6 text-slate-700'>{item.complete ? item.done : item.pending}</span>
                </li>
              ))}
            </ul>
            <div className='mt-5 rounded-[22px] border border-sky-100 bg-sky-50/70 px-4 py-4 text-sm leading-6 text-slate-700'>
              {mode === 'teacher'
                ? 'После создания урок можно будет сразу открыть, а затем при необходимости назначить классу отдельным заданием.'
                : 'После создания урок останется в выбранном roadmap-модуле. Публикация модуля и позиция вставки уже учтены.'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderStepBody() {
    switch (currentStepMeta.id) {
      case 'foundation':
        return renderFoundationStep()
      case 'format':
        return renderFormatStep()
      case 'content':
        return renderContentStep()
      case 'practice':
        return renderPracticeStep()
      case 'check':
        return renderCheckStep()
      case 'quiz':
        return renderQuizStep()
      case 'confirm':
        return renderConfirmStep()
      default:
        return null
    }
  }

  return (
    <main className={clsx(isAdminMode && 'w-full overflow-x-clip')}>
      <div className={clsx(
        'pb-32 md:pb-36',
        isAdminMode ? 'w-full max-w-full overflow-x-clip' : 'page-shell mx-auto w-full max-w-[96rem]',
      )}>
        <section className='min-w-0 overflow-hidden rounded-[32px] border border-white/70 bg-white/80 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6 lg:p-8'>
          <div className='flex flex-col gap-6'>
            <div className='flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between'>
              <div className='space-y-4'>
                {mode === 'teacher' ? (
                  <nav className='flex flex-wrap items-center gap-2 text-sm text-slate-500'>
                    <Link href='/teacher' className='transition hover:text-slate-900'>
                      Кабинет учителя
                    </Link>
                    <ChevronRight className='h-4 w-4' />
                    <span>Уроки</span>
                    <ChevronRight className='h-4 w-4' />
                    <span className='font-semibold text-slate-900'>Создание урока</span>
                  </nav>
                ) : (
                  <div className='inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600'>
                    <LayoutTemplate className='h-4 w-4 text-sky-600' />
                    Roadmap-конструктор урока
                  </div>
                )}
                <div className='max-w-3xl space-y-3'>
                  <div className='inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600'>
                    <currentStepMeta.icon className='h-4 w-4 text-sky-600' />
                    Шаг {currentStep + 1} из {steps.length}
                  </div>
                  <h1 className='text-[clamp(2rem,4.8vw,3.4rem)] font-black tracking-[-0.04em] text-slate-900'>
                    {mode === 'teacher' ? 'Создание авторского урока' : 'Создание roadmap-урока'}
                  </h1>
                  <p className='max-w-2xl text-base leading-7 text-slate-600 md:text-lg'>
                    {mode === 'teacher'
                      ? 'Соберите урок по шагам: тема, содержание, практика, проверка и итоговый квиз.'
                      : 'Один общий конструктор для админа и суперадмина: выберите модуль, позицию урока, настройте практику и итоговый квиз.'}
                  </p>
                </div>
                <div className='max-w-xl'>
                  <div className='flex items-center justify-between text-sm text-slate-500'>
                    <span>Прогресс заполнения</span>
                    <span>{progressPercent}%</span>
                  </div>
                  <div className='mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100'>
                    <div
                      className='h-full rounded-full bg-sky-600 transition-all'
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className='flex flex-wrap items-center gap-3 xl:max-w-[31rem] xl:justify-end'>
                {features.drafts ? (
                  <button
                    type='button'
                    className='inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300'
                    onClick={saveDraft}
                  >
                    <Save className='h-4 w-4' />
                    Сохранить черновик
                  </button>
                ) : null}
                {features.help ? (
                  <button
                    type='button'
                    className='inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-700'
                    onClick={() => setHelpOpen(true)}
                  >
                    <BookOpen className='h-4 w-4' />
                    Методическая помощь
                  </button>
                ) : null}
                {cancelHref ? (
                  <Link
                    href={cancelHref}
                    className='inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300'
                  >
                    Отменить
                  </Link>
                ) : null}
              </div>
            </div>

            {renderTargetSection()}

            {lastCreatedLesson ? (
              <div className='flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-emerald-200 bg-white px-4 py-4'>
                <div>
                  <p className='text-sm font-semibold text-emerald-700'>Последний созданный урок</p>
                  <p className='mt-1 text-lg font-bold text-slate-900'>{lastCreatedLesson.title}</p>
                  <p className='mt-1 text-sm leading-6 text-slate-600'>{lastCreatedLesson.summary}</p>
                </div>
                <Link
                  href={`/lessons/${lastCreatedLesson.id}`}
                  className='inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white'
                >
                  Открыть урок
                </Link>
              </div>
            ) : null}
          </div>
        </section>

        <section className={clsx(
          'mt-6 grid gap-6',
          isAdminMode ? '2xl:grid-cols-[minmax(0,1.7fr)_20rem]' : 'xl:grid-cols-[minmax(0,1.7fr)_20rem]',
        )}>
          <div className='min-w-0 overflow-hidden rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6 lg:p-8'>
            <div className='mb-6 flex flex-wrap gap-2 md:hidden'>
              {steps.map((step, index) => (
                <button
                  key={step.id}
                  type='button'
                  className={clsx(
                    'rounded-full border px-3 py-2 text-xs font-semibold transition',
                    currentStep === index
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : stepComplete(step.id, form, features.quiz)
                        ? 'border-emerald-200 bg-white text-slate-700'
                        : 'border-slate-200 bg-white text-slate-500',
                  )}
                  onClick={() => setCurrentStep(index)}
                >
                  {index + 1}. {step.title}
                </button>
              ))}
            </div>
            {renderStepBody()}
          </div>

          <aside className={isAdminMode ? 'grid gap-5 md:grid-cols-2 2xl:block 2xl:space-y-5' : 'space-y-5'}>
            <SidebarCard title='Маршрут'>
              <div className='space-y-2'>
                {steps.map((step, index) => {
                  const complete = stepComplete(step.id, form, features.quiz)
                  const Icon = step.icon
                  return (
                    <button
                      key={step.id}
                      type='button'
                      onClick={() => setCurrentStep(index)}
                      className={clsx(
                        'flex w-full items-start gap-3 rounded-[22px] border px-4 py-3 text-left transition',
                        currentStep === index
                          ? 'border-sky-200 bg-sky-50'
                          : 'border-slate-200 bg-slate-50/60 hover:border-slate-300',
                      )}
                    >
                      <span
                        className={clsx(
                          'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                          currentStep === index
                            ? 'bg-sky-600 text-white'
                            : complete
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-white text-slate-500',
                        )}
                      >
                        {complete && currentStep !== index ? <Check className='h-4 w-4' /> : index + 1}
                      </span>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2'>
                          <Icon className='h-4 w-4 text-slate-400' />
                          <p className='text-sm font-semibold text-slate-900'>{step.title}</p>
                        </div>
                        <p className='mt-1 text-xs leading-5 text-slate-500'>{step.short}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </SidebarCard>

            <SidebarCard title='Снимок'>
              <div className='space-y-3 text-sm leading-6 text-slate-600'>
                <div className='rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3'>
                  <p className='font-semibold text-slate-900'>{form.title.trim() || 'Без названия'}</p>
                  <p className='mt-1'>
                    {targetConfig.kind === 'classroom'
                      ? selectedClass
                        ? `Класс: ${selectedClass.name}`
                        : 'Класс пока не выбран'
                      : selectedModule
                        ? `Модуль: ${selectedModule.title}`
                        : 'Модуль пока не выбран'}
                  </p>
                </div>
                <div className='rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3'>
                  <p className='font-semibold text-slate-900'>Практика</p>
                  <p className='mt-1'>
                    {PRACTICE_OPTIONS.find(option => option.value === form.practiceFormat)?.label || 'Не выбрана'}
                  </p>
                </div>
                <div className='rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3'>
                  <p className='font-semibold text-slate-900'>Контроль</p>
                  <p className='mt-1'>
                    {features.quiz && form.quizEnabled
                      ? `${quizPayload.questions.length} вопросов в квизе`
                      : 'Итоговый квиз не добавлен'}
                  </p>
                </div>
                {targetConfig.kind === 'classroom' && features.sourcePrefill ? (
                  <div className='rounded-[20px] border border-slate-200 bg-slate-50/70 px-4 py-3'>
                    <p className='font-semibold text-slate-900'>Библиотека класса</p>
                    <p className='mt-1'>
                      {catalogLoading
                        ? 'Загружаем доступные уроки...'
                        : selectedClass
                          ? `Доступно уроков: ${catalog.length}`
                          : 'Выберите класс, чтобы увидеть библиотеку.'}
                    </p>
                    {targetConfig.sourceLessonId ? (
                      <p className='mt-2 text-xs leading-5 text-slate-500'>
                        {sourceLessonApplied
                          ? 'Черновик уже заполнен по выбранному уроку.'
                          : 'При открытии применится предзаполнение из выбранного урока.'}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </SidebarCard>
          </aside>
        </section>

        <div className='fixed inset-x-0 bottom-0 z-30 overflow-x-clip border-t border-slate-200 bg-white/90 backdrop-blur'>
          <div className='mx-auto flex w-full max-w-[96rem] flex-wrap items-center gap-4 px-4 py-4 sm:justify-between sm:px-6 lg:px-8'>
            <div className='min-w-0'>
              <p className='text-sm font-semibold text-slate-900'>{currentStepMeta.title}</p>
              <p className='text-xs leading-5 text-slate-500'>{currentStepMeta.short}</p>
            </div>
            <div className='ml-auto flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto sm:flex-nowrap'>
              <button
                type='button'
                className='inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none'
                onClick={goBack}
                disabled={currentStep === 0 || creatingLesson}
              >
                <ArrowLeft className='h-4 w-4' />
                Назад
              </button>
              <button
                type='button'
                className='inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none'
                onClick={goNext}
                disabled={creatingLesson}
              >
                {creatingLesson ? 'Создаем...' : nextButtonLabel(currentStep, steps)}
                {creatingLesson ? null : <ArrowRight className='h-4 w-4' />}
              </button>
            </div>
          </div>
        </div>

        {features.help && helpOpen ? (
          <div className='fixed inset-0 z-40 flex items-stretch justify-end bg-slate-950/45'>
            <button
              type='button'
              className='flex-1'
              aria-label='Закрыть методическую помощь'
              onClick={() => setHelpOpen(false)}
            />
            <div className='relative h-full w-full max-w-[34rem] overflow-y-auto border-l border-white/20 bg-white p-6 shadow-2xl sm:p-8'>
              <button
                type='button'
                className='absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300'
                onClick={() => setHelpOpen(false)}
              >
                <X className='h-5 w-5' />
              </button>
              <div className='pr-12'>
                <p className='text-sm font-semibold uppercase tracking-[0.16em] text-sky-600'>Методическая помощь</p>
                <h2 className='mt-3 text-3xl font-black tracking-[-0.04em] text-slate-900'>Подсказки по каждому шагу</h2>
                <p className='mt-3 text-sm leading-7 text-slate-600'>
                  Используйте этот справочник как быстрый чек-лист, когда хочется собрать урок аккуратно и без потери
                  логики.
                </p>
              </div>
              <div className='mt-8 space-y-4'>
                {METHODICAL_SECTIONS.map(section => (
                  <article key={section.title} className='rounded-[24px] border border-slate-200 bg-slate-50/70 p-5'>
                    <h3 className='text-lg font-semibold text-slate-900'>{section.title}</h3>
                    <p className='mt-3 text-sm leading-7 text-slate-600'>{section.description}</p>
                    <div className='mt-4 rounded-[20px] border border-sky-100 bg-white px-4 py-4 text-sm leading-6 text-slate-700'>
                      {section.example}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}

function stepComplete(stepId: BuilderStepId, form: LessonBuilderForm, quizEnabled: boolean) {
  if (stepId === 'foundation') return foundationComplete(form)
  if (stepId === 'format') return formatComplete(form)
  if (stepId === 'content') return contentComplete(form)
  if (stepId === 'practice') return practiceComplete(form)
  if (stepId === 'check') return checkComplete(form)
  if (stepId === 'quiz') return quizComplete(form, quizEnabled)
  return (
    foundationComplete(form)
    && formatComplete(form)
    && contentComplete(form)
    && practiceComplete(form)
    && checkComplete(form)
    && quizComplete(form, quizEnabled)
  )
}
