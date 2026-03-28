'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { hasExplicitCodeTaskIntent } from '@/lib/task-intent'
import {
  AssignmentItem,
  ClassroomItem,
  CodeTaskLanguage,
  LessonCatalogItem,
  SubmissionItem,
  TaskEvaluationMode,
  TeacherClassDetail,
  TeacherOverviewData,
} from '@/types'

type AssignmentType = AssignmentItem['assignment_type']
type SubmissionFormat = AssignmentItem['submission_format']

type Difficulty = 'easy' | 'medium' | 'hard'
type LessonBlueprintKey = 'guided' | 'skills' | 'project' | 'revision'
type LessonPracticeMode = 'none' | 'text' | 'code'

interface LessonJudgeTestCase {
  input: string
  expected: string
}

interface LessonFormState {
  title: string
  summary: string
  theory_text: string
  key_points: string
  interactive_steps: string
  task_title: string
  task_prompt: string
  answer_keywords: string
  starter_code: string
  task_hints: string
  age_group: 'junior' | 'middle' | 'senior'
  duration_minutes: string
  passing_score: string
  task_xp_reward: string
  evaluation_mode: TaskEvaluationMode
  programming_language: CodeTaskLanguage
  time_limit_ms: string
  memory_limit_mb: string
  judge_tests: LessonJudgeTestCase[]
}

interface LessonBlueprint {
  label: string
  short: string
  description: string
  durationByAge: Record<'junior' | 'middle' | 'senior', string>
  passingScore: string
  taskXpReward: string
  recommendedPractice: LessonPracticeMode
  sampleTitle: Record<'junior' | 'middle' | 'senior', string>
  summary: (theme: string) => string
  theory: (theme: string) => string
  keyPoints: string
  steps: string
  taskTitle: (theme: string) => string
  taskPrompt: (theme: string) => string
  keywords: string
  hints: string
  starterCode: string
}

interface AssignmentFormState {
  title: string
  description: string
  lesson_id: string
  due_date: string
  difficulty: Difficulty
  xp_reward: string
  assignment_type: AssignmentType
  submission_format: SubmissionFormat
  learning_goal: string
  work_steps: string
  success_criteria: string
  resources: string
}

interface AssignmentTemplate {
  label: string
  short: string
  title: string
  description: string
  learning_goal: string
  work_steps: string
  success_criteria: string
  resources: string
  submission_format: SubmissionFormat
}

const ASSIGNMENT_TEMPLATES: Record<AssignmentType, AssignmentTemplate> = {
  lesson_practice: {
    label: 'Практика по уроку',
    short: 'Закрепление навыка после конкретного урока.',
    title: 'Практика по уроку',
    description: 'Закрепите ключевые навыки урока и покажите рабочий результат.',
    learning_goal: 'Применить идею урока в самостоятельном решении.',
    work_steps: 'Прочитай задание.\nСделай решение.\nПроверь результат перед отправкой.',
    success_criteria: 'Решение связано с темой урока.\nЕсть корректный итоговый результат.',
    resources: 'Конспект урока.\nПримеры из практики.',
    submission_format: 'mixed',
  },
  mini_project: {
    label: 'Мини-проект',
    short: 'Небольшой проект с ссылкой на результат.',
    title: 'Мини-проект',
    description: 'Создайте небольшой проект по теме и опишите архитектуру решения.',
    learning_goal: 'Научиться собирать задачу в цельный проект и презентовать результат.',
    work_steps: 'Определи идею проекта.\nСобери рабочую версию.\nПодготовь короткую презентацию.',
    success_criteria: 'Проект запускается или читается без пояснений.\nЕсть описание, как это работает.',
    resources: 'Репозиторий примеров.\nШаблоны интерфейса/кода.',
    submission_format: 'link',
  },
  quiz: {
    label: 'Квиз / тест',
    short: 'Проверка теории и логики по теме.',
    title: 'Квиз по теме',
    description: 'Пройдите контрольный мини-тест и аргументируйте сложные ответы.',
    learning_goal: 'Проверить понимание терминов и базовой логики темы.',
    work_steps: 'Ответь на вопросы.\nПроверь спорные пункты.\nДобавь короткие пояснения.',
    success_criteria: 'Большинство ответов верные.\nПояснения логичные и по теме.',
    resources: 'Конспект урока.\nСловарь терминов.',
    submission_format: 'text',
  },
  reflection: {
    label: 'Рефлексия',
    short: 'Разбор результата и план улучшений.',
    title: 'Рефлексия по теме',
    description: 'Сформулируйте, что получилось, что вызвало сложности и как улучшить результат.',
    learning_goal: 'Развить навык анализа собственной работы.',
    work_steps: 'Опиши, что сделал.\nВыдели сложные моменты.\nПредложи следующий шаг.',
    success_criteria: 'Есть честный разбор.\nЕсть конкретный план улучшений.',
    resources: 'Личный конспект.\nОбратная связь учителя.',
    submission_format: 'text',
  },
}

const ASSIGNMENT_TYPES: AssignmentType[] = ['lesson_practice', 'mini_project', 'quiz', 'reflection']

const SUBMISSION_FORMAT_OPTIONS: Array<{ value: SubmissionFormat; label: string }> = [
  { value: 'text', label: 'Текст' },
  { value: 'code', label: 'Код' },
  { value: 'link', label: 'Ссылка' },
  { value: 'mixed', label: 'Свободный формат' },
]

const SUBMISSION_FORMAT_LABELS: Record<SubmissionFormat, string> = {
  text: 'Текст',
  code: 'Код',
  link: 'Ссылка',
  mixed: 'Свободный формат',
}

const REVIEWED_SUBMISSION_STATUSES = new Set<SubmissionItem['status']>(['checked', 'needs_revision'])

const SUBMISSION_STATUS_LABELS: Record<SubmissionItem['status'], string> = {
  submitted: 'Отправлено',
  pending_review: 'Ожидает проверки',
  checked: 'Верно',
  needs_revision: 'Неверно',
}

const EMPTY_ASSIGNMENT_FORM: AssignmentFormState = {
  title: '',
  description: '',
  lesson_id: '',
  due_date: '',
  difficulty: 'medium',
  xp_reward: '80',
  assignment_type: 'lesson_practice',
  submission_format: ASSIGNMENT_TEMPLATES.lesson_practice.submission_format,
  learning_goal: '',
  work_steps: '',
  success_criteria: '',
  resources: '',
}

function defaultProgrammingLanguage(ageGroup: 'junior' | 'middle' | 'senior'): CodeTaskLanguage {
  return ageGroup === 'senior' ? 'javascript' : 'python'
}

function ageGroupSupportsCodePractice(ageGroup: 'junior' | 'middle' | 'senior') {
  return ageGroup !== 'junior'
}

function defaultEvaluationMode(practiceMode: LessonPracticeMode): TaskEvaluationMode {
  if (practiceMode === 'code') return 'stdin_stdout'
  return 'manual'
}

function createEmptyJudgeTest(): LessonJudgeTestCase {
  return { input: '', expected: '' }
}

function buildEmptyLessonForm(
  ageGroup: 'junior' | 'middle' | 'senior' = 'middle',
  practiceMode: LessonPracticeMode = 'text',
): LessonFormState {
  return {
    title: '',
    summary: '',
    theory_text: '',
    key_points: '',
    interactive_steps: '',
    task_title: '',
    task_prompt: '',
    answer_keywords: '',
    starter_code: '',
    task_hints: '',
    age_group: ageGroup,
    duration_minutes: '10',
    passing_score: '70',
    task_xp_reward: '30',
    evaluation_mode: defaultEvaluationMode(practiceMode),
    programming_language: defaultProgrammingLanguage(ageGroup),
    time_limit_ms: '2000',
    memory_limit_mb: '128',
    judge_tests: practiceMode === 'code' ? [createEmptyJudgeTest()] : [],
  }
}

const EMPTY_LESSON_FORM: LessonFormState = buildEmptyLessonForm()

const LESSON_BLUEPRINT_KEYS: LessonBlueprintKey[] = ['guided', 'skills', 'project', 'revision']

const LESSON_BLUEPRINTS: Record<LessonBlueprintKey, LessonBlueprint> = {
  guided: {
    label: 'Понятно с нуля',
    short: 'Коротко, спокойно, без перегруза.',
    description: 'Для новой темы, когда нужно быстро ввести ученика в контекст и сразу закрепить смысл.',
    durationByAge: { junior: '15', middle: '20', senior: '25' },
    passingScore: '65',
    taskXpReward: '25',
    recommendedPractice: 'text',
    sampleTitle: {
      junior: 'Как работает алгоритм',
      middle: 'Переменные и условия',
      senior: 'Функции и параметры',
    },
    summary: (theme) => `Урок знакомит с темой «${theme}» простым языком и показывает, как применить ее на понятном примере.`,
    theory: (theme) => `Начните с жизненного примера, где тема «${theme}» действительно нужна.\nПотом объясните основной принцип простыми словами.\nЗакончите коротким выводом: что ученик должен запомнить после урока.`,
    keyPoints: 'Что означает тема простыми словами\nГде она встречается на практике\nКакой шаг здесь самый важный\nКакая ошибка бывает чаще всего',
    steps: 'Покажите стартовую ситуацию\nРазберите пример по шагам\nПопросите предсказать следующий шаг\nСоберите короткий итог урока',
    taskTitle: (theme) => `Мини-практика: ${theme}`,
    taskPrompt: (theme) => `Объясни тему «${theme}» своими словами и выполни короткое упражнение по образцу из урока.`,
    keywords: 'понятие, шаг, результат',
    hints: 'Вернись к ключевым идеям урока.\nСравни решение с примером из разбора.\nПроверь, что в ответе есть понятный итог.',
    starterCode: '',
  },
  skills: {
    label: 'Навык через действие',
    short: 'Меньше теории, больше повторяемого приема.',
    description: 'Подходит для уроков, где важнее отработать шаблон решения, чем просто узнать новый термин.',
    durationByAge: { junior: '20', middle: '30', senior: '35' },
    passingScore: '70',
    taskXpReward: '35',
    recommendedPractice: 'text',
    sampleTitle: {
      junior: 'Повторяем команды шаг за шагом',
      middle: 'Циклы на простых примерах',
      senior: 'Массивы и поиск элементов',
    },
    summary: (theme) => `Урок по теме «${theme}» помогает довести прием до уверенного использования через разбор и самостоятельное повторение.`,
    theory: (theme) => `Сначала сформулируйте, какой конкретный навык дает тема «${theme}».\nПотом покажите базовый шаблон действий.\nОтдельно подчеркните, как ученик быстро проверит себя.`,
    keyPoints: 'Как выглядит базовый шаблон решения\nГде ученики ошибаются чаще всего\nКак быстро проверить себя\nКогда этот прием лучше не использовать',
    steps: 'Соберите решение вместе с классом\nПосле каждого шага задайте вопрос «почему»\nСравните правильный и ошибочный вариант\nДайте короткое повторение по памяти',
    taskTitle: (theme) => `Тренировка навыка: ${theme}`,
    taskPrompt: (theme) => `Реши самостоятельную задачу по теме «${theme}» и постарайся повторить тот же алгоритм, что был в разборе.`,
    keywords: 'алгоритм, проверка, ошибка',
    hints: 'Сначала повтори порядок шагов из урока.\nПроверь промежуточный результат до финального ответа.\nЕсли запутался, найди шаг, на котором изменилась логика.',
    starterCode: '',
  },
  project: {
    label: 'Мини-проект',
    short: 'Урок с заметным результатом на выходе.',
    description: 'Подходит для тем, где хочется получить артефакт: историю, игру, страницу, мини-инструмент.',
    durationByAge: { junior: '25', middle: '40', senior: '50' },
    passingScore: '75',
    taskXpReward: '60',
    recommendedPractice: 'text',
    sampleTitle: {
      junior: 'Собираем мини-историю по шагам',
      middle: 'Мини-игра с условиями',
      senior: 'Трекер задач на функциях',
    },
    summary: (theme) => `Урок по теме «${theme}» ведет к небольшому, но законченному результату, который можно показать и объяснить.`,
    theory: (theme) => `Покажите, какой результат ученик соберет по итогам темы «${theme}».\nРазделите объяснение на три части: идея, структура, проверка результата.\nОбязательно скажите, какой минимум уже считается успехом.`,
    keyPoints: 'Как выглядит минимально рабочая версия\nКакие части можно собрать по очереди\nКак проверить, что каждая часть работает\nЧто можно улучшить после базовой версии',
    steps: 'Сначала соберите каркас результата\nДобавьте одну ключевую механику\nПроверьте работоспособность на коротком сценарии\nОбсудите, что улучшить дальше',
    taskTitle: (theme) => `Мини-проект: ${theme}`,
    taskPrompt: (theme) => `Собери свою рабочую версию по теме «${theme}». Важно получить результат, который можно открыть, показать или быстро объяснить.`,
    keywords: 'результат, структура, проверка',
    hints: 'Сначала добейся минимально рабочего варианта.\nПроверяй результат после каждого крупного шага.\nОпиши, что уже работает, даже если не все готово.',
    starterCode: '// Здесь можно оставить каркас решения или базовый шаблон.\n',
  },
  revision: {
    label: 'Повторение и закрепление',
    short: 'Собрать главное перед проверкой.',
    description: 'Для уроков, где нужно быстро повторить тему, отделить главное от второстепенного и снять типовые ошибки.',
    durationByAge: { junior: '15', middle: '20', senior: '25' },
    passingScore: '80',
    taskXpReward: '20',
    recommendedPractice: 'none',
    sampleTitle: {
      junior: 'Что мы запомнили про алгоритмы',
      middle: 'Повторение темы перед проверкой',
      senior: 'Быстрый обзор ключевых паттернов',
    },
    summary: (theme) => `Урок помогает быстро повторить тему «${theme}», собрать главное и увидеть, где еще есть пробелы.`,
    theory: (theme) => `Соберите в одном месте все, что нужно удержать по теме «${theme}».\nСравните близкие понятия, покажите типовые ошибки и дайте короткую памятку для самопроверки.`,
    keyPoints: 'Какие идеи обязательно помнить\nЧем похожие понятия отличаются\nКакие ошибки чаще всего срезают результат\nПо какому чек-листу себя проверить',
    steps: 'Попросите учеников назвать все, что они уже помнят\nСоберите общий список ключевых идей\nРазберите 2-3 типовые ошибки\nЗакончите памяткой или чек-листом',
    taskTitle: (theme) => `Чек-ап по теме: ${theme}`,
    taskPrompt: (theme) => `Собери короткую памятку по теме «${theme}» и покажи на одном примере, что ты различаешь правильный и ошибочный вариант.`,
    keywords: 'чек-лист, ошибка, главное',
    hints: 'Не пытайся записать все, только самое важное.\nСравни правильный и неправильный пример.\nПроверь, можно ли по твоему ответу быстро повторить тему.',
    starterCode: '',
  },
}

const PRACTICE_MODE_OPTIONS: Array<{ value: LessonPracticeMode; label: string; short: string }> = [
  { value: 'none', label: 'Без встроенной практики', short: 'Только теория и разбор' },
  { value: 'text', label: 'Мини-практика', short: 'Короткий ответ или упражнение' },
  { value: 'code', label: 'Кодовая практика', short: 'Редактор и автотесты' },
]

const TEXT_EVALUATION_OPTIONS: Array<{ value: TaskEvaluationMode; label: string; short: string }> = [
  { value: 'manual', label: 'Ручная проверка', short: 'Учитель читает ответ и пишет комментарий.' },
  { value: 'keywords', label: 'Авто по ориентирам', short: 'Система ищет ключевые слова и смысловые маркеры.' },
]

const CODE_EVALUATION_OPTIONS: Array<{ value: TaskEvaluationMode; label: string; short: string }> = [
  { value: 'stdin_stdout', label: 'Автотесты', short: 'Код запускается на тестах с входом и ожидаемым выводом.' },
]

const LANGUAGE_LABELS: Record<CodeTaskLanguage, string> = {
  python: 'Python',
  javascript: 'JavaScript',
}

const AGE_GROUP_LABELS: Record<'junior' | 'middle' | 'senior', string> = {
  junior: 'Junior',
  middle: 'Middle',
  senior: 'Senior',
}

const LESSONS_PER_PAGE = 4

function splitLines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function shortenText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

async function copyToClipboard(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  if (typeof document === 'undefined') throw new Error('Clipboard unavailable')

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function TeacherWorkspace() {
  const [overview, setOverview] = useState<TeacherOverviewData | null>(null)
  const [catalog, setCatalog] = useState<LessonCatalogItem[]>([])
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null)
  const [classDetail, setClassDetail] = useState<TeacherClassDetail | null>(null)
  const [assignmentRows, setAssignmentRows] = useState<AssignmentItem[]>([])
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<number, string>>({})
  const [message, setMessage] = useState('')
  const [classForm, setClassForm] = useState({ name: '', description: '' })
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(EMPTY_ASSIGNMENT_FORM)
  const [lessonForm, setLessonForm] = useState<LessonFormState>(EMPTY_LESSON_FORM)
  const [lessonBlueprint, setLessonBlueprint] = useState<LessonBlueprintKey>('guided')
  const [lessonPracticeMode, setLessonPracticeMode] = useState<LessonPracticeMode>('text')
  const [lessonPage, setLessonPage] = useState(1)
  const [lastCreatedLesson, setLastCreatedLesson] = useState<{ id: number; title: string; summary: string } | null>(null)

  const selectedClass = useMemo<ClassroomItem | undefined>(
    () => overview?.classes.find((item) => item.id === selectedClassId),
    [overview, selectedClassId],
  )
  const teacherLessons = useMemo(
    () => catalog.filter((lesson) => lesson.source === 'teacher'),
    [catalog],
  )
  const selectedLessonForAssignment = useMemo(
    () => catalog.find((lesson) => String(lesson.id) === assignmentForm.lesson_id) || null,
    [catalog, assignmentForm.lesson_id],
  )
  const activeLessonBlueprint = LESSON_BLUEPRINTS[lessonBlueprint]
  const availablePracticeModeOptions = useMemo(
    () => PRACTICE_MODE_OPTIONS.filter((item) => item.value !== 'code' || ageGroupSupportsCodePractice(lessonForm.age_group)),
    [lessonForm.age_group],
  )
  const selectedPracticeMode = availablePracticeModeOptions.find((item) => item.value === lessonPracticeMode) || availablePracticeModeOptions[0]
  const evaluationOptions = lessonPracticeMode === 'code' ? CODE_EVALUATION_OPTIONS : TEXT_EVALUATION_OPTIONS
  const selectedEvaluationMode = evaluationOptions.find((item) => item.value === lessonForm.evaluation_mode) || evaluationOptions[0]
  const lessonKeyPoints = useMemo(() => splitLines(lessonForm.key_points), [lessonForm.key_points])
  const lessonInteractiveSteps = useMemo(() => splitLines(lessonForm.interactive_steps), [lessonForm.interactive_steps])
  const lessonTaskHints = useMemo(() => splitLines(lessonForm.task_hints), [lessonForm.task_hints])
  const lessonAnswerKeywords = useMemo(() => lessonForm.answer_keywords.split(',').map((item) => item.trim()).filter(Boolean), [lessonForm.answer_keywords])
  const configuredJudgeTests = useMemo(
    () => lessonForm.judge_tests.filter((item) => item.input.trim() || item.expected.trim()),
    [lessonForm.judge_tests],
  )
  const lessonPreviewTitle = lessonForm.title.trim() || activeLessonBlueprint.sampleTitle[lessonForm.age_group]
  const lessonPreviewSummary = lessonForm.summary.trim() || activeLessonBlueprint.summary(lessonPreviewTitle)
  const lessonHasPractice = lessonPracticeMode !== 'none'
  const lessonProgress = useMemo(
    () => [
      {
        label: 'Основа урока',
        done: Boolean(lessonForm.title.trim() && lessonForm.summary.trim()),
        detail: 'Название и краткое описание',
      },
      {
        label: 'Подача темы',
        done: Boolean(lessonForm.theory_text.trim() || lessonKeyPoints.length >= 3),
        detail: 'Объяснение или тезисы',
      },
      {
        label: 'Маршрут урока',
        done: lessonInteractiveSteps.length >= 2,
        detail: 'Минимум два шага разбора',
      },
      {
        label: 'Практика',
        done: lessonHasPractice
          ? Boolean(
            (lessonForm.task_title.trim() || lessonForm.task_prompt.trim())
            && (
              lessonPracticeMode === 'code'
                ? configuredJudgeTests.length > 0
                : lessonForm.evaluation_mode === 'manual'
                  || (lessonForm.evaluation_mode === 'keywords' && lessonAnswerKeywords.length > 0)
                  || (lessonForm.evaluation_mode === 'stdin_stdout' && configuredJudgeTests.length > 0)
            ),
          )
          : true,
        detail: lessonHasPractice
          ? lessonPracticeMode === 'code'
            ? 'Есть кодовая задача и как минимум один автотест'
            : lessonForm.evaluation_mode === 'stdin_stdout'
            ? 'Есть задача и как минимум один автотест'
            : lessonForm.evaluation_mode === 'keywords'
              ? 'Есть задача и ориентиры для автопроверки'
              : 'Есть задача для ручной проверки'
          : 'Практика вынесена отдельно',
      },
    ],
    [
      configuredJudgeTests.length,
      lessonAnswerKeywords.length,
      lessonForm.evaluation_mode,
      lessonForm.summary,
      lessonForm.task_prompt,
      lessonForm.task_title,
      lessonForm.theory_text,
      lessonForm.title,
      lessonHasPractice,
      lessonInteractiveSteps.length,
      lessonKeyPoints.length,
    ],
  )
  const lessonCompletion = Math.round((lessonProgress.filter((item) => item.done).length / lessonProgress.length) * 100)
  const messageIsError = /^не удалось|^ошибка/i.test(message.trim())
  const reviewedCount = submissions.filter((item) => REVIEWED_SUBMISSION_STATUSES.has(item.status)).length
  const totalLessonPages = Math.max(1, Math.ceil(catalog.length / LESSONS_PER_PAGE))
  const paginatedLessons = useMemo(
    () => catalog.slice((lessonPage - 1) * LESSONS_PER_PAGE, lessonPage * LESSONS_PER_PAGE),
    [catalog, lessonPage],
  )

  async function handleCopyClassCode(code: string) {
    try {
      await copyToClipboard(code)
      setMessage(`Код класса ${code} скопирован.`)
    } catch {
      setMessage('Не удалось скопировать код класса.')
    }
  }

  useEffect(() => {
    setLessonPage(1)
  }, [selectedClassId])

  useEffect(() => {
    if (!ageGroupSupportsCodePractice(lessonForm.age_group) && lessonPracticeMode === 'code') {
      setLessonPracticeMode('text')
    }
  }, [lessonForm.age_group, lessonPracticeMode])

  useEffect(() => {
    setLessonForm((current) => {
      if (lessonPracticeMode === 'none') {
        if (current.evaluation_mode === 'manual' && current.judge_tests.length === 0) {
          return current
        }
        return {
          ...current,
          evaluation_mode: 'manual',
          judge_tests: [],
        }
      }
      if (lessonPracticeMode === 'code') {
        if (current.evaluation_mode !== 'stdin_stdout') {
          return {
            ...current,
            evaluation_mode: 'stdin_stdout',
            judge_tests: current.judge_tests.length > 0 ? current.judge_tests : [createEmptyJudgeTest()],
          }
        }
        if (current.evaluation_mode === 'stdin_stdout' && current.judge_tests.length === 0) {
          return {
            ...current,
            judge_tests: [createEmptyJudgeTest()],
          }
        }
        return current
      }
      if (current.evaluation_mode === 'stdin_stdout') {
        return {
          ...current,
          evaluation_mode: 'manual',
          judge_tests: [],
        }
      }
      return current
    })
  }, [lessonPracticeMode])

  useEffect(() => {
    setLessonPage((current) => Math.min(current, totalLessonPages))
  }, [totalLessonPages])

  function patchAssignmentStats(assignmentId: number, rows: SubmissionItem[]) {
    setAssignmentRows((current) => current.map((assignment) => (
      assignment.id === assignmentId
        ? {
            ...assignment,
            submissions_count: rows.length,
            checked_count: rows.filter((item) => REVIEWED_SUBMISSION_STATUSES.has(item.status)).length,
          }
        : assignment
    )))
  }

  function addJudgeTest() {
    setLessonForm((current) => ({
      ...current,
      judge_tests: [...current.judge_tests, createEmptyJudgeTest()],
    }))
  }

  function updateJudgeTest(index: number, patch: Partial<LessonJudgeTestCase>) {
    setLessonForm((current) => ({
      ...current,
      judge_tests: current.judge_tests.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    }))
  }

  function removeJudgeTest(index: number) {
    setLessonForm((current) => ({
      ...current,
      judge_tests: current.judge_tests.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  function applyAssignmentTemplate(type: AssignmentType, replaceFilledFields = false) {
    const template = ASSIGNMENT_TEMPLATES[type]
    const lessonAwareTitle = type === 'lesson_practice' && selectedLessonForAssignment
      ? `Задание по уроку: ${selectedLessonForAssignment.title}`
      : template.title
    const lessonAwareDescription = type === 'lesson_practice' && selectedLessonForAssignment
      ? selectedLessonForAssignment.summary
      : template.description

    setAssignmentForm((current) => {
      const useTemplate = (value: string) => replaceFilledFields || !value.trim()
      return {
        ...current,
        assignment_type: type,
        submission_format: template.submission_format,
        title: useTemplate(current.title) ? lessonAwareTitle : current.title,
        description: useTemplate(current.description) ? lessonAwareDescription : current.description,
        learning_goal: useTemplate(current.learning_goal) ? template.learning_goal : current.learning_goal,
        work_steps: useTemplate(current.work_steps) ? template.work_steps : current.work_steps,
        success_criteria: useTemplate(current.success_criteria) ? template.success_criteria : current.success_criteria,
        resources: useTemplate(current.resources) ? template.resources : current.resources,
      }
    })
  }

  function selectLessonForAssignment(lesson: LessonCatalogItem) {
    setAssignmentForm((current) => ({
      ...current,
      assignment_type: 'lesson_practice',
      submission_format: ASSIGNMENT_TEMPLATES.lesson_practice.submission_format,
      lesson_id: String(lesson.id),
      title: current.title || `Задание по уроку: ${lesson.title}`,
      description: current.description || lesson.summary,
      learning_goal: current.learning_goal || ASSIGNMENT_TEMPLATES.lesson_practice.learning_goal,
      work_steps: current.work_steps || ASSIGNMENT_TEMPLATES.lesson_practice.work_steps,
      success_criteria: current.success_criteria || ASSIGNMENT_TEMPLATES.lesson_practice.success_criteria,
    }))
  }

  function applyLessonBlueprint(replaceFilledFields = false) {
    const template = LESSON_BLUEPRINTS[lessonBlueprint]
    setLessonForm((current) => {
      const useTemplate = (value: string) => replaceFilledFields || !value.trim()
      const nextTitle = useTemplate(current.title) ? template.sampleTitle[current.age_group] : current.title
      const theme = nextTitle.trim() || template.sampleTitle[current.age_group]
      return {
        ...current,
        title: nextTitle,
        summary: useTemplate(current.summary) ? template.summary(theme) : current.summary,
        theory_text: useTemplate(current.theory_text) ? template.theory(theme) : current.theory_text,
        key_points: useTemplate(current.key_points) ? template.keyPoints : current.key_points,
        interactive_steps: useTemplate(current.interactive_steps) ? template.steps : current.interactive_steps,
        task_title: useTemplate(current.task_title) ? template.taskTitle(theme) : current.task_title,
        task_prompt: useTemplate(current.task_prompt) ? template.taskPrompt(theme) : current.task_prompt,
        answer_keywords: useTemplate(current.answer_keywords) ? template.keywords : current.answer_keywords,
        task_hints: useTemplate(current.task_hints) ? template.hints : current.task_hints,
        starter_code: lessonPracticeMode === 'code' && useTemplate(current.starter_code) ? template.starterCode : current.starter_code,
        duration_minutes: useTemplate(current.duration_minutes) ? template.durationByAge[current.age_group] : current.duration_minutes,
        passing_score: useTemplate(current.passing_score) ? template.passingScore : current.passing_score,
        task_xp_reward: useTemplate(current.task_xp_reward) ? template.taskXpReward : current.task_xp_reward,
      }
    })
  }

  function applyLessonRecommendations() {
    const template = LESSON_BLUEPRINTS[lessonBlueprint]
    setLessonForm((current) => ({
      ...current,
      duration_minutes: template.durationByAge[current.age_group],
      passing_score: template.passingScore,
      task_xp_reward: template.taskXpReward,
      starter_code: lessonPracticeMode === 'code' && !current.starter_code.trim() ? template.starterCode : current.starter_code,
      programming_language: lessonPracticeMode === 'code' ? current.programming_language : defaultProgrammingLanguage(current.age_group),
      time_limit_ms: current.time_limit_ms.trim() || '2000',
      memory_limit_mb: current.memory_limit_mb.trim() || '128',
      judge_tests: lessonPracticeMode === 'code' && current.evaluation_mode === 'stdin_stdout' && current.judge_tests.length === 0
        ? [createEmptyJudgeTest()]
        : current.judge_tests,
    }))
  }

  function resetLessonComposer() {
    const nextForm = buildEmptyLessonForm(lessonForm.age_group, lessonPracticeMode)
    setLessonForm({
      ...nextForm,
      duration_minutes: activeLessonBlueprint.durationByAge[lessonForm.age_group],
      passing_score: activeLessonBlueprint.passingScore,
      task_xp_reward: activeLessonBlueprint.taskXpReward,
      starter_code: lessonPracticeMode === 'code' ? activeLessonBlueprint.starterCode : '',
    })
  }

  function useCatalogLessonAsStartingPoint(lesson: LessonCatalogItem) {
    setLessonForm((current) => ({
      ...current,
      title: lesson.title,
      summary: lesson.summary,
      age_group: lesson.module_age_group,
      programming_language: defaultProgrammingLanguage(lesson.module_age_group),
      duration_minutes: String(lesson.duration_minutes),
      passing_score: String(lesson.passing_score),
    }))
    setMessage(`Черновик заполнен на основе урока «${lesson.title}». Добавьте свой контент и сохраните авторскую версию.`)
  }

  async function loadOverview() {
    const data = await api<TeacherOverviewData>('/teacher/overview', undefined, true)
    setOverview(data)
    if (!selectedClassId && data.classes[0]) {
      setSelectedClassId(data.classes[0].id)
    }
  }

  async function loadCatalog(classroomId: number) {
    const data = await api<{ lessons: LessonCatalogItem[] }>(`/teacher/lesson-catalog?classroom_id=${classroomId}`, undefined, true)
    setCatalog(data.lessons)
  }

  async function loadClassDetails(classroomId: number) {
    const [detail, assignments, nextOverview] = await Promise.all([
      api<TeacherClassDetail>(`/teacher/classes/${classroomId}`, undefined, true),
      api<{ assignments: AssignmentItem[] }>(`/teacher/classes/${classroomId}/assignments`, undefined, true),
      api<TeacherOverviewData>('/teacher/overview', undefined, true),
    ])
    setClassDetail(detail)
    setAssignmentRows(assignments.assignments)
    setOverview(nextOverview)
    setSelectedAssignmentId((current) => {
      if (current && assignments.assignments.some((item) => item.id === current)) {
        return current
      }
      return assignments.assignments[0]?.id ?? null
    })
  }

  async function loadSubmissions(assignmentId: number) {
    const [data, nextOverview] = await Promise.all([
      api<{ assignment: AssignmentItem; submissions: SubmissionItem[] }>(`/teacher/assignments/${assignmentId}/submissions`, undefined, true),
      api<TeacherOverviewData>('/teacher/overview', undefined, true),
    ])
    setSubmissions(data.submissions)
    setFeedbackDrafts(data.submissions.reduce<Record<number, string>>((acc, submission) => {
      acc[submission.id] = submission.feedback || ''
      return acc
    }, {}))
    patchAssignmentStats(assignmentId, data.submissions)
    setOverview(nextOverview)
  }

  useEffect(() => {
    loadOverview().catch(() => setMessage('Не удалось загрузить кабинет учителя. Проверьте авторизацию и попробуйте снова.'))
  }, [])

  useEffect(() => {
    if (!selectedClassId) {
      setCatalog([])
      setClassDetail(null)
      setAssignmentRows([])
      setSelectedAssignmentId(null)
      setLastCreatedLesson(null)
      return
    }
    setLastCreatedLesson(null)
    Promise.all([loadClassDetails(selectedClassId), loadCatalog(selectedClassId)]).catch(() => {
      setMessage('Не удалось загрузить уроки и задания выбранного класса.')
    })
  }, [selectedClassId])

  useEffect(() => {
    if (selectedAssignmentId) {
      loadSubmissions(selectedAssignmentId).catch(() => {
        setSubmissions([])
        setFeedbackDrafts({})
      })
      return
    }
    setSubmissions([])
    setFeedbackDrafts({})
  }, [selectedAssignmentId])

  async function createClass(event: FormEvent) {
    event.preventDefault()
    await api('/teacher/classes', { method: 'POST', body: JSON.stringify(classForm) }, true)
    setClassForm({ name: '', description: '' })
    setMessage('Класс создан.')
    await loadOverview()
  }

  async function createLesson(event: FormEvent) {
    event.preventDefault()
    if (!selectedClassId) return
    try {
      if (!ageGroupSupportsCodePractice(lessonForm.age_group) && lessonPracticeMode === 'code') {
        setMessage('Для Junior-уроков кодовая практика недоступна. Выберите текстовое задание.')
        return
      }
      if (
        lessonPracticeMode === 'text'
        && hasExplicitCodeTaskIntent({
          title: lessonForm.task_title,
          prompt: lessonForm.task_prompt,
          starterCode: lessonForm.starter_code,
        })
      ) {
        setMessage('Похоже, это кодовая практика. Выберите режим "Кодовая практика" и добавьте автотесты.')
        return
      }
      const judgeTestsPayload = lessonForm.evaluation_mode === 'stdin_stdout'
        ? lessonForm.judge_tests
          .filter((item) => item.input.trim() || item.expected.trim())
          .map((item, index) => ({
            label: `Тест ${index + 1}`,
            input: item.input,
            expected: item.expected,
          }))
        : []
      if (lessonPracticeMode === 'code' && judgeTestsPayload.length === 0) {
        setMessage('Для кодовой практики нужен хотя бы один автотест.')
        return
      }
      const data = await api<{ lesson: { id: number; title: string; summary: string } }>(
        `/teacher/classes/${selectedClassId}/lessons`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...lessonForm,
            task_type: lessonPracticeMode === 'code' ? 'code' : 'text',
            task_title: lessonHasPractice
              ? (lessonForm.task_title.trim() || activeLessonBlueprint.taskTitle(lessonPreviewTitle))
              : '',
            task_prompt: lessonHasPractice
              ? (lessonForm.task_prompt.trim() || activeLessonBlueprint.taskPrompt(lessonPreviewTitle))
              : '',
            answer_keywords: lessonHasPractice && lessonForm.evaluation_mode === 'keywords' ? lessonForm.answer_keywords : '',
            starter_code: lessonPracticeMode === 'code' ? lessonForm.starter_code : '',
            task_hints: lessonHasPractice ? lessonForm.task_hints : '',
            evaluation_mode: lessonHasPractice ? lessonForm.evaluation_mode : 'manual',
            programming_language: lessonPracticeMode === 'code' ? lessonForm.programming_language : null,
            judge_tests: judgeTestsPayload,
            duration_minutes: Number(lessonForm.duration_minutes),
            passing_score: Number(lessonForm.passing_score),
            time_limit_ms: lessonForm.evaluation_mode === 'stdin_stdout' ? Number(lessonForm.time_limit_ms) : null,
            memory_limit_mb: lessonForm.evaluation_mode === 'stdin_stdout' ? Number(lessonForm.memory_limit_mb) : null,
          }),
        },
        true,
      )
      const nextForm = buildEmptyLessonForm(lessonForm.age_group, lessonPracticeMode)
      setLessonForm({
        ...nextForm,
        duration_minutes: activeLessonBlueprint.durationByAge[lessonForm.age_group],
        passing_score: activeLessonBlueprint.passingScore,
        task_xp_reward: activeLessonBlueprint.taskXpReward,
        starter_code: lessonPracticeMode === 'code' ? activeLessonBlueprint.starterCode : '',
      })
      setLastCreatedLesson(data.lesson)
      setAssignmentForm((current) => ({
        ...current,
        assignment_type: 'lesson_practice',
        submission_format: ASSIGNMENT_TEMPLATES.lesson_practice.submission_format,
        lesson_id: String(data.lesson.id),
        title: current.title || `Задание по уроку: ${data.lesson.title}`,
        description: current.description || data.lesson.summary,
        learning_goal: current.learning_goal || ASSIGNMENT_TEMPLATES.lesson_practice.learning_goal,
        work_steps: current.work_steps || ASSIGNMENT_TEMPLATES.lesson_practice.work_steps,
        success_criteria: current.success_criteria || ASSIGNMENT_TEMPLATES.lesson_practice.success_criteria,
      }))
      setMessage('Авторский урок создан. Его уже можно открыть и сразу назначить классу.')
      await Promise.all([loadCatalog(selectedClassId), loadClassDetails(selectedClassId)])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось создать урок.')
    }
  }

  async function createAssignment(event: FormEvent) {
    event.preventDefault()
    if (!selectedClassId) return
    await api(
      `/teacher/classes/${selectedClassId}/assignments`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...assignmentForm,
          lesson_id: assignmentForm.lesson_id ? Number(assignmentForm.lesson_id) : null,
        }),
      },
      true,
    )
    setAssignmentForm((current) => ({
      ...EMPTY_ASSIGNMENT_FORM,
      assignment_type: current.assignment_type,
      submission_format: current.submission_format,
      lesson_id: current.lesson_id,
    }))
    setMessage('Задание назначено классу.')
    await loadClassDetails(selectedClassId)
  }

  async function gradeSubmission(submissionId: number, status: 'checked' | 'needs_revision', currentScore: number, currentFeedback?: string | null) {
    await api(
      `/teacher/submissions/${submissionId}/grade`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          score: currentScore,
          feedback: currentFeedback || (status === 'checked' ? 'Урок выполнен верно.' : 'Нужно доработать и отправить ещё раз.'),
          status,
        }),
      },
      true,
    )
    setMessage(status === 'checked' ? 'Урок отмечен как выполненный.' : 'Урок отправлен на доработку.')
    if (selectedAssignmentId) {
      await loadSubmissions(selectedAssignmentId)
    }
  }

  return (
    <div className="space-y-6">
      {message && <div className={`codequest-card p-4 text-sm font-semibold ${messageIsError ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{message}</div>}
      {lastCreatedLesson && (
        <div className="codequest-card border border-emerald-200 bg-emerald-50/80 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-600">Последний созданный урок</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">{lastCreatedLesson.title}</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{lastCreatedLesson.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/lessons/${lastCreatedLesson.id}`} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Открыть урок
              </Link>
              <a href="#assignment-builder" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                Назначить классу
              </a>
            </div>
          </div>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Классы', String(overview?.summary.classes || 0)],
          ['Ученики', String(overview?.summary.students || 0)],
          ['Задания', String(overview?.summary.assignments || 0)],
          ['Сдачи', String(overview?.summary.submissions || 0)],
        ].map(([label, value]) => (
          <div key={label} className="codequest-card p-5">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 2xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <form onSubmit={createClass} className="codequest-card p-6">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Новый класс</p>
            <div className="mt-4 space-y-3">
              <input className="w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Название класса" value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} />
              <textarea className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder="Описание" value={classForm.description} onChange={(e) => setClassForm({ ...classForm, description: e.target.value })} />
              <button className="w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:w-auto">Создать класс</button>
            </div>
          </form>

          <div className="codequest-card p-6">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Мои классы</p>
            <div className="mt-4 space-y-3">
              {overview?.classes.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border px-4 py-4 ${selectedClassId === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedClassId(item.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="break-words text-lg font-black">{item.name}</p>
                      <p className={`mt-2 text-sm ${selectedClassId === item.id ? 'text-slate-300' : 'text-slate-500'}`}>Код входа:</p>
                      <p className={`break-all font-mono text-sm font-semibold ${selectedClassId === item.id ? 'text-white' : 'text-slate-700'}`}>{item.code}</p>
                    </button>
                    <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${selectedClassId === item.id ? 'bg-white text-slate-900' : 'bg-sky-50 text-sky-700'}`}>{item.students_count} учен.</span>
                      <button
                        type="button"
                        onClick={() => handleCopyClassCode(item.code)}
                        className={`rounded-full px-3 py-2 text-xs font-bold ${selectedClassId === item.id ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}`}
                      >
                        Копировать код
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <section className="codequest-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Ученики класса</p>
                <h2 className="mt-2 break-words text-2xl font-black text-slate-900">{selectedClass?.name || 'Список появится после выбора класса'}</h2>
              </div>
              {selectedClass && (
                <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                  {classDetail?.students.length || 0} учен.
                </span>
              )}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {selectedClass
                ? 'Быстрый просмотр состава класса и прогресса учеников.'
                : 'Выберите класс выше, чтобы увидеть учеников и их прогресс.'}
            </p>

            <div className="mt-5 space-y-3">
              {classDetail?.students.length ? (
                classDetail.students.map((student) => (
                  <div key={student.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-900">{student.full_name}</p>
                        <p className="text-sm text-slate-500">@{student.username}</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700">XP {student.xp}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                      <span className="rounded-full bg-white px-3 py-1">Уровень {student.level}</span>
                      <span className="rounded-full bg-white px-3 py-1">Уроков {student.completed_lessons}</span>
                      <span className="rounded-full bg-white px-3 py-1">Средний балл {student.average_score}%</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                  В выбранном классе пока нет учеников.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="codequest-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Выбранный класс</p>
                <h2 className="mt-2 break-words text-2xl font-black text-slate-900 sm:text-3xl">{selectedClass?.name || 'Выберите класс'}</h2>
              </div>
              {selectedClass && (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                  <span className="max-w-full rounded-full bg-slate-900 px-4 py-2 font-mono text-sm font-semibold text-white break-all">
                    Код {selectedClass.code}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyClassCode(selectedClass.code)}
                    className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm"
                  >
                    Копировать
                  </button>
                </div>
              )}
            </div>
            <p className="mt-3 text-slate-600">{classDetail?.classroom.description || 'Выберите класс, чтобы назначать уроки и проверять работы.'}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Учеников</p>
                <p className="mt-2 text-3xl font-black text-slate-900">{classDetail?.students.length || 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Заданий</p>
                <p className="mt-2 text-3xl font-black text-slate-900">{assignmentRows.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Проверено</p>
                <p className="mt-2 text-3xl font-black text-slate-900">{reviewedCount}</p>
              </div>
            </div>
          </section>

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
                  <p className="text-sm font-bold uppercase tracking-[0.22em] text-emerald-100">Конструктор урока</p>
                  <h3 className="mt-3 text-2xl font-black sm:text-3xl">Соберите урок по шагам</h3>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-sky-50/90">Выберите шаблон, заполните основу и проверьте короткий предпросмотр справа.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-white/12 px-3 py-2 backdrop-blur">Класс: {selectedClass?.name || 'не выбран'}</span>
                  <span className="rounded-full bg-white/12 px-3 py-2 backdrop-blur">Готовность {lessonCompletion}%</span>
                  <span className="rounded-full bg-white/12 px-3 py-2 backdrop-blur">{selectedPracticeMode.label}</span>
                </div>
              </div>
            </div>

            <div className="grid gap-5 p-4 sm:gap-6 sm:p-6 2xl:grid-cols-[minmax(0,1.15fr)_320px]">
              <div className="min-w-0 space-y-5">
                <div className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">1. Сценарий</p>
                      <h4 className="mt-2 text-2xl font-black text-slate-900">Выберите шаблон</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => applyLessonBlueprint(false)} className="w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 sm:w-auto">Дополнить пустые поля</button>
                      <button type="button" onClick={() => applyLessonBlueprint(true)} className="w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 sm:w-auto">Перезаписать шаблоном</button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
                    {LESSON_BLUEPRINT_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setLessonBlueprint(key)}
                        className={`min-w-0 rounded-[24px] border p-4 text-left transition ${lessonBlueprint === key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-lg font-black">{LESSON_BLUEPRINTS[key].label}</p>
                            <p className={`mt-1 text-sm ${lessonBlueprint === key ? 'text-slate-300' : 'text-slate-500'}`}>{LESSON_BLUEPRINTS[key].short}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${lessonBlueprint === key ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-600'}`}>{lessonBlueprint === key ? 'Выбран' : 'Шаблон'}</span>
                        </div>
                        <p className={`mt-3 text-sm leading-5 ${lessonBlueprint === key ? 'text-slate-200' : 'text-slate-600'}`}>
                          {shortenText(LESSON_BLUEPRINTS[key].description, 92)}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[26px] border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">2. Формат</p>
                      <h4 className="mt-2 text-2xl font-black text-slate-900">Тип практики</h4>
                    </div>
                    <button type="button" onClick={applyLessonRecommendations} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">Подставить рекомендации</button>
                  </div>
                  <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    {availablePracticeModeOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setLessonPracticeMode(option.value)}
                        className={`rounded-[24px] border p-4 text-left transition ${lessonPracticeMode === option.value ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      >
                        <p className="text-base font-black text-slate-900">{option.label}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{option.short}</p>
                      </button>
                    ))}
                  </div>
                  {lessonForm.age_group === 'junior' && (
                    <p className="mt-3 text-xs text-slate-500">
                      Для Junior доступны только текстовые практики без редактора кода и автотестов.
                    </p>
                  )}
                </div>

                <div className="rounded-[26px] border border-slate-200 bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">3. Основа урока</p>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <input className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder={activeLessonBlueprint.sampleTitle[lessonForm.age_group]} value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
                    <select className="rounded-2xl border border-slate-200 px-4 py-3" value={lessonForm.age_group} onChange={(e) => {
                      const nextAgeGroup = e.target.value as 'junior' | 'middle' | 'senior'
                      setLessonForm({
                        ...lessonForm,
                        age_group: nextAgeGroup,
                        programming_language: lessonPracticeMode === 'code' ? defaultProgrammingLanguage(nextAgeGroup) : lessonForm.programming_language,
                      })
                    }}>
                      <option value="junior">Junior</option>
                      <option value="middle">Middle</option>
                      <option value="senior">Senior</option>
                    </select>
                    <div className="grid grid-cols-2 gap-3">
                      <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Минуты" type="number" min={5} max={180} value={lessonForm.duration_minutes} onChange={(e) => setLessonForm({ ...lessonForm, duration_minutes: e.target.value })} />
                      <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Порог %" type="number" min={0} max={100} value={lessonForm.passing_score} onChange={(e) => setLessonForm({ ...lessonForm, passing_score: e.target.value })} />
                    </div>
                    <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3 lg:col-span-2" placeholder={activeLessonBlueprint.summary(lessonPreviewTitle)} value={lessonForm.summary} onChange={(e) => setLessonForm({ ...lessonForm, summary: e.target.value })} />
                  </div>
                </div>

                <div className="rounded-[26px] border border-slate-200 bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">4. Содержание</p>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <textarea className="min-h-32 rounded-2xl border border-slate-200 px-4 py-3 lg:col-span-2" placeholder={activeLessonBlueprint.theory(lessonPreviewTitle)} value={lessonForm.theory_text} onChange={(e) => setLessonForm({ ...lessonForm, theory_text: e.target.value })} />
                    <div>
                      <textarea className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder={activeLessonBlueprint.keyPoints} value={lessonForm.key_points} onChange={(e) => setLessonForm({ ...lessonForm, key_points: e.target.value })} />
                      <p className="mt-2 text-xs text-slate-500">Пунктов: {lessonKeyPoints.length || 0}. Каждая новая строка станет отдельной идеей.</p>
                    </div>
                    <div>
                      <textarea className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3" placeholder={activeLessonBlueprint.steps} value={lessonForm.interactive_steps} onChange={(e) => setLessonForm({ ...lessonForm, interactive_steps: e.target.value })} />
                      <p className="mt-2 text-xs text-slate-500">Шагов: {lessonInteractiveSteps.length || 0}. Каждая новая строка станет отдельным шагом разбора.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[26px] border border-slate-200 bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">5. Практика и проверка</p>
                  {!lessonHasPractice ? (
                    <div className="mt-4 rounded-[22px] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                      Урок сохранится без встроенной практики. Закрепление можно выдать отдельным заданием ниже.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder={activeLessonBlueprint.taskTitle(lessonPreviewTitle)} value={lessonForm.task_title} onChange={(e) => setLessonForm({ ...lessonForm, task_title: e.target.value })} />
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          <p className="font-semibold text-slate-800">Режим проверки: {selectedEvaluationMode.label}</p>
                          <p className="mt-1">{selectedEvaluationMode.short}</p>
                        </div>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2">
                        {evaluationOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setLessonForm((current) => ({
                              ...current,
                              evaluation_mode: option.value,
                              judge_tests: option.value === 'stdin_stdout'
                                ? (current.judge_tests.length > 0 ? current.judge_tests : [createEmptyJudgeTest()])
                                : current.judge_tests,
                            }))}
                            className={`rounded-[22px] border p-4 text-left transition ${lessonForm.evaluation_mode === option.value ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                          >
                            <p className="text-base font-black text-slate-900">{option.label}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{option.short}</p>
                          </button>
                        ))}
                      </div>

                      <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3" placeholder={activeLessonBlueprint.taskPrompt(lessonPreviewTitle)} value={lessonForm.task_prompt} onChange={(e) => setLessonForm({ ...lessonForm, task_prompt: e.target.value })} />

                      {lessonForm.evaluation_mode === 'keywords' && (
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                          <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder={activeLessonBlueprint.keywords} value={lessonForm.answer_keywords} onChange={(e) => setLessonForm({ ...lessonForm, answer_keywords: e.target.value })} />
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                            Система будет искать ориентиры в ответе. Подходит для текста, структурированных заметок и коротких объяснений.
                          </div>
                        </div>
                      )}

                      {lessonPracticeMode === 'code' && (
                        <div className="grid gap-3 lg:grid-cols-2">
                          <select className="rounded-2xl border border-slate-200 px-4 py-3" value={lessonForm.programming_language} onChange={(e) => setLessonForm({ ...lessonForm, programming_language: e.target.value as CodeTaskLanguage })}>
                            <option value="python">Python</option>
                            <option value="javascript">JavaScript</option>
                          </select>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                            Кодовая практика всегда проверяется автотестами. Ожидается консольная программа: чтение из stdin и вывод в stdout.
                          </div>
                        </div>
                      )}

                      {lessonForm.evaluation_mode === 'stdin_stdout' && (
                        <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                          <div className="grid gap-3 lg:grid-cols-2">
                            <input className="rounded-2xl border border-slate-200 px-4 py-3" type="number" min={500} max={10000} placeholder="Лимит времени, мс" value={lessonForm.time_limit_ms} onChange={(e) => setLessonForm({ ...lessonForm, time_limit_ms: e.target.value })} />
                            <input className="rounded-2xl border border-slate-200 px-4 py-3" type="number" min={32} max={1024} placeholder="Память, МБ" value={lessonForm.memory_limit_mb} onChange={(e) => setLessonForm({ ...lessonForm, memory_limit_mb: e.target.value })} />
                          </div>
                          <div className="space-y-3">
                            {lessonForm.judge_tests.map((testCase, index) => (
                              <div key={`${index}-${testCase.input.length}-${testCase.expected.length}`} className="rounded-[22px] border border-slate-200 bg-white p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <p className="text-sm font-black text-slate-900">Тест {index + 1}</p>
                                  <button type="button" onClick={() => removeJudgeTest(index)} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                                    Удалить
                                  </button>
                                </div>
                                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                  <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs leading-6" placeholder="stdin" value={testCase.input} onChange={(e) => updateJudgeTest(index, { input: e.target.value })} />
                                  <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs leading-6" placeholder="ожидаемый stdout" value={testCase.expected} onChange={(e) => updateJudgeTest(index, { expected: e.target.value })} />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={addJudgeTest} className="w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 sm:w-auto">
                              Добавить тест
                            </button>
                            <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600">Настроено тестов: {configuredJudgeTests.length}</span>
                          </div>
                        </div>
                      )}

                      {lessonPracticeMode === 'code' && (
                        <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs leading-6" placeholder={activeLessonBlueprint.starterCode || 'Стартовый код или каркас ответа'} value={lessonForm.starter_code} onChange={(e) => setLessonForm({ ...lessonForm, starter_code: e.target.value })} />
                      )}

                      <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3" placeholder={activeLessonBlueprint.hints} value={lessonForm.task_hints} onChange={(e) => setLessonForm({ ...lessonForm, task_hints: e.target.value })} />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[26px] border border-slate-200 bg-slate-50/80 p-5">
                  <div>
                    <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Финальный шаг</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedClassId ? 'После создания урок сразу появится в библиотеке класса и привяжется к конструктору задания.' : 'Чтобы сохранить урок, сначала выберите класс слева.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={resetLessonComposer} className="w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 sm:w-auto">Очистить черновик</button>
                    <button disabled={!selectedClassId} className="w-full rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">Создать урок</button>
                  </div>
                </div>
              </div>

              <aside className="min-w-0 space-y-4">
                <div className="rounded-[26px] border border-slate-900 bg-slate-900 p-5 text-white">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300">Готовность черновика</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${lessonCompletion}%` }} />
                  </div>
                  <div className="mt-4 space-y-3">
                    {lessonProgress.map((item) => (
                      <div key={item.label} className="rounded-2xl bg-white/6 p-3">
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-300">{item.detail}</p>
                        <p className={`mt-2 text-xs font-bold uppercase tracking-[0.14em] ${item.done ? 'text-emerald-300' : 'text-slate-500'}`}>{item.done ? 'готово' : 'нужно заполнить'}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[26px] border border-emerald-200 bg-emerald-50/80 p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Предпросмотр урока</p>
                  <h4 className="mt-2 text-2xl font-black text-slate-900">{lessonPreviewTitle}</h4>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{shortenText(lessonPreviewSummary, 150)}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
                    <span className="rounded-full bg-white px-3 py-1">{AGE_GROUP_LABELS[lessonForm.age_group as keyof typeof AGE_GROUP_LABELS]}</span>
                    <span className="rounded-full bg-white px-3 py-1">{lessonForm.duration_minutes} мин</span>
                    <span className="rounded-full bg-white px-3 py-1">Порог {lessonForm.passing_score}%</span>
                    <span className="rounded-full bg-white px-3 py-1">{selectedPracticeMode.label}</span>
                    {lessonHasPractice && <span className="rounded-full bg-white px-3 py-1">{selectedEvaluationMode.label}</span>}
                    {lessonHasPractice && lessonPracticeMode === 'code' && <span className="rounded-full bg-white px-3 py-1">{LANGUAGE_LABELS[lessonForm.programming_language]}</span>}
                  </div>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Ключевые идеи</p>
                      {lessonKeyPoints.length > 0 ? <p className="mt-2 text-sm leading-6 text-slate-700">{lessonKeyPoints.slice(0, 3).join(' · ')}</p> : <p className="mt-2 text-sm text-slate-500">Пока не добавлены.</p>}
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Шаги разбора</p>
                      {lessonInteractiveSteps.length > 0 ? <p className="mt-2 text-sm leading-6 text-slate-700">{lessonInteractiveSteps.slice(0, 3).join(' · ')}</p> : <p className="mt-2 text-sm text-slate-500">Пока не добавлены.</p>}
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Практика</p>
                      {lessonHasPractice ? (
                        <div className="mt-2 text-sm leading-6 text-slate-700">
                          <p className="font-semibold text-slate-900">{lessonForm.task_title.trim() || activeLessonBlueprint.taskTitle(lessonPreviewTitle)}</p>
                          <p className="mt-1">{shortenText(lessonForm.task_prompt.trim() || activeLessonBlueprint.taskPrompt(lessonPreviewTitle), 120)}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            {lessonForm.evaluation_mode === 'stdin_stdout'
                              ? `Автотестов: ${configuredJudgeTests.length} · Лимит: ${lessonForm.time_limit_ms || '2000'} мс`
                              : lessonForm.evaluation_mode === 'keywords'
                                ? `Ключевых слов: ${lessonAnswerKeywords.length || 0} · Подсказок: ${lessonTaskHints.length || 0}`
                                : `Ручная проверка · Подсказок: ${lessonTaskHints.length || 0}`}
                          </p>
                        </div>
                      ) : <p className="mt-2 text-sm text-slate-500">Практика будет вынесена в отдельное задание.</p>}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </form>

          <section className="codequest-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Уроки класса</p>
                <h3 className="mt-2 text-2xl font-black text-slate-900">Библиотека + авторские уроки</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">{catalog.length} уроков доступно</span>
                <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600">Стр. {lessonPage} из {totalLessonPages}</span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {paginatedLessons.map((lesson) => (
                <div key={lesson.id} className={`rounded-2xl border p-4 ${lesson.source === 'teacher' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-black text-slate-900">{lesson.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{lesson.module_title}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${lesson.source === 'teacher' ? 'bg-white text-emerald-700' : 'bg-white text-sky-700'}`}>{lesson.source_label}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{shortenText(lesson.summary, 150)}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => selectLessonForAssignment(lesson)} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                      Выбрать для задания
                    </button>
                    <button type="button" onClick={() => useCatalogLessonAsStartingPoint(lesson)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                      Взять за основу
                    </button>
                    <Link href={`/lessons/${lesson.id}`} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                      Открыть урок
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {totalLessonPages > 1 && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600">Показываем по {LESSONS_PER_PAGE} урока на страницу.</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setLessonPage((current) => Math.max(1, current - 1))}
                    disabled={lessonPage === 1}
                    className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    onClick={() => setLessonPage((current) => Math.min(totalLessonPages, current + 1))}
                    disabled={lessonPage === totalLessonPages}
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Вперёд
                  </button>
                </div>
              </div>
            )}

            {teacherLessons.length === 0 && (
              <p className="mt-4 text-sm text-slate-500">Пока нет авторских уроков. Создайте первый урок выше.</p>
            )}
          </section>
          <form id="assignment-builder" onSubmit={createAssignment} className="codequest-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Назначить задание</p>
                <h3 className="mt-2 text-2xl font-black text-slate-900">Конструктор заданий</h3>
              </div>
              <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">3 шага: тип → параметры → критерии</span>
            </div>

            <p className="mt-5 text-sm font-bold uppercase tracking-[0.18em] text-slate-500">1. Вид задания</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {ASSIGNMENT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setAssignmentForm((current) => ({
                    ...current,
                    assignment_type: type,
                    submission_format: ASSIGNMENT_TEMPLATES[type].submission_format,
                  }))}
                  className={`rounded-2xl border p-4 text-left transition ${assignmentForm.assignment_type === type ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <p className="text-base font-black text-slate-900">{ASSIGNMENT_TEMPLATES[type].label}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{ASSIGNMENT_TEMPLATES[type].short}</p>
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">Выбран тип: {ASSIGNMENT_TEMPLATES[assignmentForm.assignment_type].label}</p>
              <p className="mt-1">Рекомендованный формат сдачи: {SUBMISSION_FORMAT_LABELS[assignmentForm.submission_format]}</p>
              {selectedLessonForAssignment && <p className="mt-1">Привязан урок: {selectedLessonForAssignment.title}</p>}
            </div>

            <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-slate-500">2. Основные параметры</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input className="rounded-2xl border border-slate-200 px-4 py-3" placeholder="Название задания" value={assignmentForm.title} onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })} />
              <select className="rounded-2xl border border-slate-200 px-4 py-3" value={assignmentForm.lesson_id} onChange={(e) => setAssignmentForm({ ...assignmentForm, lesson_id: e.target.value })}>
                <option value="">Без привязки к уроку</option>
                {catalog.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    [{lesson.source === 'teacher' ? 'Ваш урок' : 'Каталог'}] {lesson.title}
                  </option>
                ))}
              </select>
              <input className="rounded-2xl border border-slate-200 px-4 py-3" type="date" value={assignmentForm.due_date} onChange={(e) => setAssignmentForm({ ...assignmentForm, due_date: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <select className="rounded-2xl border border-slate-200 px-4 py-3" value={assignmentForm.difficulty} onChange={(e) => setAssignmentForm({ ...assignmentForm, difficulty: e.target.value as Difficulty })}>
                  <option value="easy">easy</option>
                  <option value="medium">medium</option>
                  <option value="hard">hard</option>
                </select>
                <select className="rounded-2xl border border-slate-200 px-4 py-3" value={assignmentForm.submission_format} onChange={(e) => setAssignmentForm({ ...assignmentForm, submission_format: e.target.value as SubmissionFormat })}>
                  {SUBMISSION_FORMAT_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500">За задания учителя XP не начисляется. Учитель проверяет ответ вручную.</p>

            <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-slate-500">3. Содержание и ожидания</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Цель обучения" value={assignmentForm.learning_goal} onChange={(e) => setAssignmentForm({ ...assignmentForm, learning_goal: e.target.value })} />
              <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Материалы и ссылки (каждая строка отдельно)" value={assignmentForm.resources} onChange={(e) => setAssignmentForm({ ...assignmentForm, resources: e.target.value })} />
              <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Шаги выполнения (каждый шаг с новой строки)" value={assignmentForm.work_steps} onChange={(e) => setAssignmentForm({ ...assignmentForm, work_steps: e.target.value })} />
              <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3" placeholder="Критерии успеха (каждый пункт с новой строки)" value={assignmentForm.success_criteria} onChange={(e) => setAssignmentForm({ ...assignmentForm, success_criteria: e.target.value })} />
              <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" placeholder="Описание задания" value={assignmentForm.description} onChange={(e) => setAssignmentForm({ ...assignmentForm, description: e.target.value })} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => applyAssignmentTemplate(assignmentForm.assignment_type, true)} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
                Заполнить шаблон под выбранный тип
              </button>
              <button type="button" onClick={() => applyAssignmentTemplate(assignmentForm.assignment_type)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                Дополнить пустые поля
              </button>
              <button disabled={!selectedClassId} className="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Добавить задание</button>
            </div>
          </form>

          <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="codequest-card p-6">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Задания класса</p>
              <div className="mt-4 space-y-3">
                {assignmentRows.map((assignment) => (
                  <button key={assignment.id} type="button" onClick={() => setSelectedAssignmentId(assignment.id)} className={`w-full rounded-2xl border px-4 py-4 text-left ${selectedAssignmentId === assignment.id ? 'border-sky-600 bg-sky-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-900">{assignment.title}</p>
                        <p className="mt-1 text-sm text-slate-500">{assignment.assignment_type_label} · {assignment.difficulty} · дедлайн {assignment.due_date || 'без срока'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {assignment.lesson && <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-700">{assignment.lesson.title}</span>}
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{SUBMISSION_FORMAT_LABELS[assignment.submission_format]}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-600">Сдач: {assignment.submissions_count || 0} · Проверено: {assignment.checked_count || 0}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="codequest-card p-6">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-600">Проверка сдач</p>
              <div className="mt-4 space-y-4">
                {submissions.map((submission) => (
                  <div key={submission.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-900">@{submission.student_username}</p>
                        <p className="text-sm text-slate-500">{new Date(submission.submitted_at).toLocaleString('ru-RU')}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${
                          submission.status === 'checked'
                            ? 'bg-emerald-100 text-emerald-700'
                            : submission.status === 'needs_revision'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-sky-100 text-sky-700'
                        }`}>{SUBMISSION_STATUS_LABELS[submission.status]}</span>
                        <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700">{submission.score}%</span>
                      </div>
                    </div>
                    <pre className="mt-3 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-emerald-200">{submission.answer || 'Ученик пока не приложил текст ответа.'}</pre>
                    <textarea
                      value={feedbackDrafts[submission.id] ?? ''}
                      onChange={(e) => setFeedbackDrafts((current) => ({ ...current, [submission.id]: e.target.value }))}
                      className="mt-3 min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                      placeholder="Комментарий ученику"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => gradeSubmission(submission.id, 'checked', submission.score, feedbackDrafts[submission.id])}
                        className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                      >
                        Верно
                      </button>
                      <button
                        type="button"
                        onClick={() => gradeSubmission(submission.id, 'needs_revision', submission.score, feedbackDrafts[submission.id])}
                        className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white"
                      >
                        Неверно
                      </button>
                    </div>
                  </div>
                ))}
                {selectedAssignmentId && submissions.length === 0 && <p className="text-sm text-slate-500">У этого задания пока нет сдач.</p>}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
