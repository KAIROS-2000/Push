'use client'

import { UserLocalTime } from '@/components/user-local-time'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
	AssignmentItem,
	ClassJoinRequestItem,
	ClassroomItem,
	CodeTaskLanguage,
	LessonCatalogItem,
	SubmissionItem,
	TaskEvaluationMode,
	TeacherClassDetail,
	TeacherJoinRequestsResponse,
	TeacherOverviewData,
} from '@/types'
import Link from 'next/link'
import {
	useEffect,
	useMemo,
	useState,
	type FormEvent,
} from 'react'

type AssignmentType = AssignmentItem['assignment_type']
type SubmissionFormat = AssignmentItem['submission_format']

type Difficulty = 'easy' | 'medium' | 'hard'
type LessonBlueprintKey = 'guided' | 'skills' | 'project' | 'revision'
type LessonPracticeMode = 'none' | 'text' | 'code'
type ClassRequiredField = 'name'
type JoinRequestAction = 'approve' | 'reject'

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

type AssignmentRequiredField =
	| 'title'
	| 'lesson_id'
	| 'due_date'
	| 'learning_goal'
	| 'resources'
	| 'work_steps'
	| 'success_criteria'
	| 'description'

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
		description:
			'Закрепите ключевые навыки урока и покажите рабочий результат.',
		learning_goal: 'Применить идею урока в самостоятельном решении.',
		work_steps:
			'Прочитай задание.\nСделай решение.\nПроверь результат перед отправкой.',
		success_criteria:
			'Решение связано с темой урока.\nЕсть корректный итоговый результат.',
		resources: 'Конспект урока.\nПримеры из практики.',
		submission_format: 'mixed',
	},
	mini_project: {
		label: 'Мини-проект',
		short: 'Небольшой проект с ссылкой на результат.',
		title: 'Мини-проект',
		description:
			'Создайте небольшой проект по теме и опишите архитектуру решения.',
		learning_goal:
			'Научиться собирать задачу в цельный проект и презентовать результат.',
		work_steps:
			'Определи идею проекта.\nСобери рабочую версию.\nПодготовь короткую презентацию.',
		success_criteria:
			'Проект запускается или читается без пояснений.\nЕсть описание, как это работает.',
		resources: 'Репозиторий примеров.\nШаблоны интерфейса/кода.',
		submission_format: 'link',
	},
	quiz: {
		label: 'Квиз / тест',
		short: 'Проверка теории и логики по теме.',
		title: 'Квиз по теме',
		description:
			'Пройдите контрольный мини-тест и аргументируйте сложные ответы.',
		learning_goal: 'Проверить понимание терминов и базовой логики темы.',
		work_steps:
			'Ответь на вопросы.\nПроверь спорные пункты.\nДобавь короткие пояснения.',
		success_criteria:
			'Большинство ответов верные.\nПояснения логичные и по теме.',
		resources: 'Конспект урока.\nСловарь терминов.',
		submission_format: 'text',
	},
	reflection: {
		label: 'Рефлексия',
		short: 'Разбор результата и план улучшений.',
		title: 'Рефлексия по теме',
		description:
			'Сформулируйте, что получилось, что вызвало сложности и как улучшить результат.',
		learning_goal: 'Развить навык анализа собственной работы.',
		work_steps:
			'Опиши, что сделал.\nВыдели сложные моменты.\nПредложи следующий шаг.',
		success_criteria: 'Есть честный разбор.\nЕсть конкретный план улучшений.',
		resources: 'Личный конспект.\nОбратная связь учителя.',
		submission_format: 'text',
	},
}

const ASSIGNMENT_TYPES: AssignmentType[] = [
	'lesson_practice',
	'mini_project',
	'quiz',
	'reflection',
]

const SUBMISSION_FORMAT_OPTIONS: Array<{
	value: SubmissionFormat
	label: string
}> = [
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

const REVIEWED_SUBMISSION_STATUSES = new Set<SubmissionItem['status']>([
	'checked',
	'needs_revision',
])

const SUBMISSION_STATUS_LABELS: Record<SubmissionItem['status'], string> = {
	submitted: 'Отправлено',
	pending_review: 'Ожидает проверки',
	checked: 'Верно',
	needs_revision: 'Неверно',
}

function practiceHeatSegmentColor(
	failureRate: number | null,
	reviewed: number,
): string {
	if (reviewed === 0) return 'rgb(226 232 240)'
	const x = Math.min(100, Math.max(0, failureRate ?? 0)) / 100
	const r = Math.round(16 + (244 - 16) * x)
	const g = Math.round(185 + (63 - 185) * x)
	const b = Math.round(129 + (94 - 129) * x)
	return `rgb(${r} ${g} ${b})`
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

const ASSIGNMENT_REQUIRED_FIELD_LABELS: Record<
	AssignmentRequiredField,
	string
> = {
	title: 'название задания',
	lesson_id: 'урок',
	due_date: 'дедлайн',
	learning_goal: 'цель обучения',
	resources: 'материалы',
	work_steps: 'шаги выполнения',
	success_criteria: 'критерии успеха',
	description: 'описание задания',
}

const CLASS_REQUIRED_FIELD_LABELS: Record<ClassRequiredField, string> = {
	name: 'название класса',
}

function getMissingClassFields(form: {
	name: string
	description: string
}): ClassRequiredField[] {
	return form.name.trim() ? [] : ['name']
}

function getMissingAssignmentFields(
	form: AssignmentFormState,
): AssignmentRequiredField[] {
	const missing: AssignmentRequiredField[] = []

	if (!form.title.trim()) missing.push('title')
	if (!form.lesson_id.trim()) missing.push('lesson_id')
	if (!form.due_date.trim()) missing.push('due_date')
	if (!form.learning_goal.trim()) missing.push('learning_goal')
	if (!form.resources.trim()) missing.push('resources')
	if (!form.work_steps.trim()) missing.push('work_steps')
	if (!form.success_criteria.trim()) missing.push('success_criteria')
	if (!form.description.trim()) missing.push('description')

	return missing
}

function defaultProgrammingLanguage(
	ageGroup: 'junior' | 'middle' | 'senior',
): CodeTaskLanguage {
	return ageGroup === 'senior' ? 'javascript' : 'python'
}

function ageGroupSupportsCodePractice(
	ageGroup: 'junior' | 'middle' | 'senior',
) {
	return ageGroup !== 'junior'
}

function defaultEvaluationMode(
	practiceMode: LessonPracticeMode,
): TaskEvaluationMode {
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

const LESSON_BLUEPRINT_KEYS: LessonBlueprintKey[] = [
	'guided',
	'skills',
	'project',
	'revision',
]

const LESSON_BLUEPRINTS: Record<LessonBlueprintKey, LessonBlueprint> = {
	guided: {
		label: 'Понятно с нуля',
		short: 'Коротко, спокойно, без перегруза.',
		description:
			'Для новой темы, когда нужно быстро ввести ученика в контекст и сразу закрепить смысл.',
		durationByAge: { junior: '15', middle: '20', senior: '25' },
		passingScore: '65',
		taskXpReward: '25',
		recommendedPractice: 'text',
		sampleTitle: {
			junior: 'Как работает алгоритм',
			middle: 'Переменные и условия',
			senior: 'Функции и параметры',
		},
		summary: theme =>
			`Урок знакомит с темой «${theme}» простым языком и показывает, как применить ее на понятном примере.`,
		theory: theme =>
			`Начните с жизненного примера, где тема «${theme}» действительно нужна.\nПотом объясните основной принцип простыми словами.\nЗакончите коротким выводом: что ученик должен запомнить после урока.`,
		keyPoints:
			'Что означает тема простыми словами\nГде она встречается на практике\nКакой шаг здесь самый важный\nКакая ошибка бывает чаще всего',
		steps:
			'Покажите стартовую ситуацию\nРазберите пример по шагам\nПопросите предсказать следующий шаг\nСоберите короткий итог урока',
		taskTitle: theme => `Мини-практика: ${theme}`,
		taskPrompt: theme =>
			`Объясни тему «${theme}» своими словами и выполни короткое упражнение по образцу из урока.`,
		keywords: 'понятие, шаг, результат',
		hints:
			'Вернись к ключевым идеям урока.\nСравни решение с примером из разбора.\nПроверь, что в ответе есть понятный итог.',
		starterCode: '',
	},
	skills: {
		label: 'Навык через действие',
		short: 'Меньше теории, больше повторяемого приема.',
		description:
			'Подходит для уроков, где важнее отработать шаблон решения, чем просто узнать новый термин.',
		durationByAge: { junior: '20', middle: '30', senior: '35' },
		passingScore: '70',
		taskXpReward: '35',
		recommendedPractice: 'text',
		sampleTitle: {
			junior: 'Повторяем команды шаг за шагом',
			middle: 'Циклы на простых примерах',
			senior: 'Массивы и поиск элементов',
		},
		summary: theme =>
			`Урок по теме «${theme}» помогает довести прием до уверенного использования через разбор и самостоятельное повторение.`,
		theory: theme =>
			`Сначала сформулируйте, какой конкретный навык дает тема «${theme}».\nПотом покажите базовый шаблон действий.\nОтдельно подчеркните, как ученик быстро проверит себя.`,
		keyPoints:
			'Как выглядит базовый шаблон решения\nГде ученики ошибаются чаще всего\nКак быстро проверить себя\nКогда этот прием лучше не использовать',
		steps:
			'Соберите решение вместе с классом\nПосле каждого шага задайте вопрос «почему»\nСравните правильный и ошибочный вариант\nДайте короткое повторение по памяти',
		taskTitle: theme => `Тренировка навыка: ${theme}`,
		taskPrompt: theme =>
			`Реши самостоятельную задачу по теме «${theme}» и постарайся повторить тот же алгоритм, что был в разборе.`,
		keywords: 'алгоритм, проверка, ошибка',
		hints:
			'Сначала повтори порядок шагов из урока.\nПроверь промежуточный результат до финального ответа.\nЕсли запутался, найди шаг, на котором изменилась логика.',
		starterCode: '',
	},
	project: {
		label: 'Мини-проект',
		short: 'Урок с заметным результатом на выходе.',
		description:
			'Подходит для тем, где хочется получить артефакт: историю, игру, страницу, мини-инструмент.',
		durationByAge: { junior: '25', middle: '40', senior: '50' },
		passingScore: '75',
		taskXpReward: '60',
		recommendedPractice: 'text',
		sampleTitle: {
			junior: 'Собираем мини-историю по шагам',
			middle: 'Мини-игра с условиями',
			senior: 'Трекер задач на функциях',
		},
		summary: theme =>
			`Урок по теме «${theme}» ведет к небольшому, но законченному результату, который можно показать и объяснить.`,
		theory: theme =>
			`Покажите, какой результат ученик соберет по итогам темы «${theme}».\nРазделите объяснение на три части: идея, структура, проверка результата.\nОбязательно скажите, какой минимум уже считается успехом.`,
		keyPoints:
			'Как выглядит минимально рабочая версия\nКакие части можно собрать по очереди\nКак проверить, что каждая часть работает\nЧто можно улучшить после базовой версии',
		steps:
			'Сначала соберите каркас результата\nДобавьте одну ключевую механику\nПроверьте работоспособность на коротком сценарии\nОбсудите, что улучшить дальше',
		taskTitle: theme => `Мини-проект: ${theme}`,
		taskPrompt: theme =>
			`Собери свою рабочую версию по теме «${theme}». Важно получить результат, который можно открыть, показать или быстро объяснить.`,
		keywords: 'результат, структура, проверка',
		hints:
			'Сначала добейся минимально рабочего варианта.\nПроверяй результат после каждого крупного шага.\nОпиши, что уже работает, даже если не все готово.',
		starterCode: '// Здесь можно оставить каркас решения или базовый шаблон.\n',
	},
	revision: {
		label: 'Повторение и закрепление',
		short: 'Собрать главное перед проверкой.',
		description:
			'Для уроков, где нужно быстро повторить тему, отделить главное от второстепенного и снять типовые ошибки.',
		durationByAge: { junior: '15', middle: '20', senior: '25' },
		passingScore: '80',
		taskXpReward: '20',
		recommendedPractice: 'none',
		sampleTitle: {
			junior: 'Что мы запомнили про алгоритмы',
			middle: 'Повторение темы перед проверкой',
			senior: 'Быстрый обзор ключевых паттернов',
		},
		summary: theme =>
			`Урок помогает быстро повторить тему «${theme}», собрать главное и увидеть, где еще есть пробелы.`,
		theory: theme =>
			`Соберите в одном месте все, что нужно удержать по теме «${theme}».\nСравните близкие понятия, покажите типовые ошибки и дайте короткую памятку для самопроверки.`,
		keyPoints:
			'Какие идеи обязательно помнить\nЧем похожие понятия отличаются\nКакие ошибки чаще всего срезают результат\nПо какому чек-листу себя проверить',
		steps:
			'Попросите учеников назвать все, что они уже помнят\nСоберите общий список ключевых идей\nРазберите 2-3 типовые ошибки\nЗакончите памяткой или чек-листом',
		taskTitle: theme => `Чек-ап по теме: ${theme}`,
		taskPrompt: theme =>
			`Собери короткую памятку по теме «${theme}» и покажи на одном примере, что ты различаешь правильный и ошибочный вариант.`,
		keywords: 'чек-лист, ошибка, главное',
		hints:
			'Не пытайся записать все, только самое важное.\nСравни правильный и неправильный пример.\nПроверь, можно ли по твоему ответу быстро повторить тему.',
		starterCode: '',
	},
}

const PRACTICE_MODE_OPTIONS: Array<{
	value: LessonPracticeMode
	label: string
	short: string
}> = [
	{
		value: 'none',
		label: 'Без встроенной практики',
		short: 'Только теория и разбор',
	},
	{
		value: 'text',
		label: 'Мини-практика',
		short: 'Короткий ответ или упражнение',
	},
	{ value: 'code', label: 'Кодовая практика', short: 'Редактор и автотесты' },
]

const TEXT_EVALUATION_OPTIONS: Array<{
	value: TaskEvaluationMode
	label: string
	short: string
}> = [
	{
		value: 'manual',
		label: 'Ручная проверка',
		short: 'Учитель читает ответ и пишет комментарий.',
	},
	{
		value: 'keywords',
		label: 'Авто по ориентирам',
		short: 'Система ищет ключевые слова и смысловые маркеры.',
	},
]

const CODE_EVALUATION_OPTIONS: Array<{
	value: TaskEvaluationMode
	label: string
	short: string
}> = [
	{
		value: 'stdin_stdout',
		label: 'Автотесты',
		short: 'Код запускается на тестах с входом и ожидаемым выводом.',
	},
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
		.map(item => item.trim())
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

function getJoinRequestStudentName(request: ClassJoinRequestItem) {
	return (
		request.student_full_name ||
		`Ученик #${request.student_id}`
	)
}

export function TeacherWorkspace({
	initialOverview = null,
}: {
	initialOverview?: TeacherOverviewData | null
}) {
	const [overview, setOverview] = useState<TeacherOverviewData | null>(
		initialOverview,
	)
	const [joinRequests, setJoinRequests] = useState<ClassJoinRequestItem[]>([])
	const [joinRequestsLoading, setJoinRequestsLoading] = useState(false)
	const [joinRequestConfirm, setJoinRequestConfirm] = useState<{
		request: ClassJoinRequestItem
		action: JoinRequestAction
	} | null>(null)
	const [joinRequestSubmitting, setJoinRequestSubmitting] = useState(false)
	const [catalog, setCatalog] = useState<LessonCatalogItem[]>([])
	const [selectedClassId, setSelectedClassId] = useState<number | null>(
		initialOverview?.classes[0]?.id ?? null,
	)
	const [classDetail, setClassDetail] = useState<TeacherClassDetail | null>(
		null,
	)
	const [assignmentRows, setAssignmentRows] = useState<AssignmentItem[]>([])
	const [selectedAssignmentId, setSelectedAssignmentId] = useState<
		number | null
	>(null)
	const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
	const [feedbackDrafts, setFeedbackDrafts] = useState<Record<number, string>>(
		{},
	)
	const [classForm, setClassForm] = useState({ name: '', description: '' })
	const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(
		EMPTY_ASSIGNMENT_FORM,
	)
	const [lessonForm, setLessonForm] =
		useState<LessonFormState>(EMPTY_LESSON_FORM)
	const [lessonBlueprint, setLessonBlueprint] =
		useState<LessonBlueprintKey>('guided')
	const [lessonPracticeMode, setLessonPracticeMode] =
		useState<LessonPracticeMode>('text')
	const [lessonPage, setLessonPage] = useState(1)
	const selectedClass = useMemo<ClassroomItem | undefined>(
		() => overview?.classes.find(item => item.id === selectedClassId),
		[overview, selectedClassId],
	)
	const teacherLessons = useMemo(
		() => catalog.filter(lesson => lesson.source === 'teacher'),
		[catalog],
	)
	const createLessonHref = selectedClassId
		? `/teacher/lessons/create?classId=${selectedClassId}`
		: '/teacher/lessons/create'
	const missingClassFields = useMemo(
		() => getMissingClassFields(classForm),
		[classForm],
	)
	const canCreateClass = missingClassFields.length === 0
	const missingAssignmentFields = useMemo(
		() => getMissingAssignmentFields(assignmentForm),
		[assignmentForm],
	)
	const missingAssignmentFieldLabels = useMemo(
		() =>
			missingAssignmentFields.map(
				field => ASSIGNMENT_REQUIRED_FIELD_LABELS[field],
			),
		[missingAssignmentFields],
	)
	const canCreateAssignment =
		Boolean(selectedClassId) && missingAssignmentFields.length === 0
	const selectedLessonForAssignment = useMemo(
		() =>
			catalog.find(lesson => String(lesson.id) === assignmentForm.lesson_id) ||
			null,
		[catalog, assignmentForm.lesson_id],
	)
	const activeLessonBlueprint = LESSON_BLUEPRINTS[lessonBlueprint]
	const availablePracticeModeOptions = useMemo(
		() =>
			PRACTICE_MODE_OPTIONS.filter(
				item =>
					item.value !== 'code' ||
					ageGroupSupportsCodePractice(lessonForm.age_group),
			),
		[lessonForm.age_group],
	)
	const selectedPracticeMode =
		availablePracticeModeOptions.find(
			item => item.value === lessonPracticeMode,
		) || availablePracticeModeOptions[0]
	const evaluationOptions =
		lessonPracticeMode === 'code'
			? CODE_EVALUATION_OPTIONS
			: TEXT_EVALUATION_OPTIONS
	const selectedEvaluationMode =
		evaluationOptions.find(item => item.value === lessonForm.evaluation_mode) ||
		evaluationOptions[0]
	const lessonKeyPoints = useMemo(
		() => splitLines(lessonForm.key_points),
		[lessonForm.key_points],
	)
	const lessonInteractiveSteps = useMemo(
		() => splitLines(lessonForm.interactive_steps),
		[lessonForm.interactive_steps],
	)
	const lessonTaskHints = useMemo(
		() => splitLines(lessonForm.task_hints),
		[lessonForm.task_hints],
	)
	const lessonAnswerKeywords = useMemo(
		() =>
			lessonForm.answer_keywords
				.split(',')
				.map(item => item.trim())
				.filter(Boolean),
		[lessonForm.answer_keywords],
	)
	const configuredJudgeTests = useMemo(
		() =>
			lessonForm.judge_tests.filter(
				item => item.input.trim() || item.expected.trim(),
			),
		[lessonForm.judge_tests],
	)
	const lessonPreviewTitle =
		lessonForm.title.trim() ||
		activeLessonBlueprint.sampleTitle[lessonForm.age_group]
	const lessonPreviewSummary =
		lessonForm.summary.trim() ||
		activeLessonBlueprint.summary(lessonPreviewTitle)
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
				done: Boolean(
					lessonForm.theory_text.trim() || lessonKeyPoints.length >= 3,
				),
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
							(lessonForm.task_title.trim() || lessonForm.task_prompt.trim()) &&
							(lessonPracticeMode === 'code'
								? configuredJudgeTests.length > 0
								: lessonForm.evaluation_mode === 'manual' ||
									(lessonForm.evaluation_mode === 'keywords' &&
										lessonAnswerKeywords.length > 0) ||
									(lessonForm.evaluation_mode === 'stdin_stdout' &&
										configuredJudgeTests.length > 0)),
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
	const lessonCompletion = Math.round(
		(lessonProgress.filter(item => item.done).length / lessonProgress.length) *
			100,
	)
	const reviewedCount = submissions.filter(item =>
		REVIEWED_SUBMISSION_STATUSES.has(item.status),
	).length
	const totalLessonPages = Math.max(
		1,
		Math.ceil(catalog.length / LESSONS_PER_PAGE),
	)
	const paginatedLessons = useMemo(
		() =>
			catalog.slice(
				(lessonPage - 1) * LESSONS_PER_PAGE,
				lessonPage * LESSONS_PER_PAGE,
			),
		[catalog, lessonPage],
	)
	async function handleCopyClassCode(code: string) {
		try {
			await copyToClipboard(code)
			showSuccessToast(`Код класса ${code} скопирован.`)
		} catch {
			showErrorToast('Не удалось скопировать код класса.')
		}
	}

	useEffect(() => {
		setLessonPage(1)
	}, [selectedClassId])

	useEffect(() => {
		if (
			!ageGroupSupportsCodePractice(lessonForm.age_group) &&
			lessonPracticeMode === 'code'
		) {
			setLessonPracticeMode('text')
		}
	}, [lessonForm.age_group, lessonPracticeMode])

	useEffect(() => {
		setLessonForm(current => {
			if (lessonPracticeMode === 'none') {
				if (
					current.evaluation_mode === 'manual' &&
					current.judge_tests.length === 0
				) {
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
						judge_tests:
							current.judge_tests.length > 0
								? current.judge_tests
								: [createEmptyJudgeTest()],
					}
				}
				if (
					current.evaluation_mode === 'stdin_stdout' &&
					current.judge_tests.length === 0
				) {
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
		setLessonPage(current => Math.min(current, totalLessonPages))
	}, [totalLessonPages])

	function patchAssignmentStats(assignmentId: number, rows: SubmissionItem[]) {
		setAssignmentRows(current =>
			current.map(assignment =>
				assignment.id === assignmentId
					? {
							...assignment,
							submissions_count: rows.length,
							checked_count: rows.filter(item =>
								REVIEWED_SUBMISSION_STATUSES.has(item.status),
							).length,
						}
					: assignment,
			),
		)
	}

	function addJudgeTest() {
		setLessonForm(current => ({
			...current,
			judge_tests: [...current.judge_tests, createEmptyJudgeTest()],
		}))
	}

	function updateJudgeTest(index: number, patch: Partial<LessonJudgeTestCase>) {
		setLessonForm(current => ({
			...current,
			judge_tests: current.judge_tests.map((item, itemIndex) =>
				itemIndex === index ? { ...item, ...patch } : item,
			),
		}))
	}

	function removeJudgeTest(index: number) {
		setLessonForm(current => ({
			...current,
			judge_tests: current.judge_tests.filter(
				(_, itemIndex) => itemIndex !== index,
			),
		}))
	}

	function applyAssignmentTemplate(
		type: AssignmentType,
		replaceFilledFields = false,
	) {
		const template = ASSIGNMENT_TEMPLATES[type]
		const lessonAwareTitle =
			type === 'lesson_practice' && selectedLessonForAssignment
				? `Задание по уроку: ${selectedLessonForAssignment.title}`
				: template.title
		const lessonAwareDescription =
			type === 'lesson_practice' && selectedLessonForAssignment
				? selectedLessonForAssignment.summary
				: template.description

		setAssignmentForm(current => {
			const useTemplate = (value: string) =>
				replaceFilledFields || !value.trim()
			return {
				...current,
				assignment_type: type,
				submission_format: template.submission_format,
				title: useTemplate(current.title) ? lessonAwareTitle : current.title,
				description: useTemplate(current.description)
					? lessonAwareDescription
					: current.description,
				learning_goal: useTemplate(current.learning_goal)
					? template.learning_goal
					: current.learning_goal,
				work_steps: useTemplate(current.work_steps)
					? template.work_steps
					: current.work_steps,
				success_criteria: useTemplate(current.success_criteria)
					? template.success_criteria
					: current.success_criteria,
				resources: useTemplate(current.resources)
					? template.resources
					: current.resources,
			}
		})
	}

	function selectLessonForAssignment(lesson: LessonCatalogItem) {
		setAssignmentForm(current => ({
			...current,
			assignment_type: 'lesson_practice',
			submission_format: ASSIGNMENT_TEMPLATES.lesson_practice.submission_format,
			lesson_id: String(lesson.id),
			title: current.title || `Задание по уроку: ${lesson.title}`,
			description: current.description || lesson.summary,
			learning_goal:
				current.learning_goal ||
				ASSIGNMENT_TEMPLATES.lesson_practice.learning_goal,
			work_steps:
				current.work_steps || ASSIGNMENT_TEMPLATES.lesson_practice.work_steps,
			success_criteria:
				current.success_criteria ||
				ASSIGNMENT_TEMPLATES.lesson_practice.success_criteria,
		}))
	}

	function applyLessonBlueprint(replaceFilledFields = false) {
		const template = LESSON_BLUEPRINTS[lessonBlueprint]
		setLessonForm(current => {
			const useTemplate = (value: string) =>
				replaceFilledFields || !value.trim()
			const nextTitle = useTemplate(current.title)
				? template.sampleTitle[current.age_group]
				: current.title
			const theme = nextTitle.trim() || template.sampleTitle[current.age_group]
			return {
				...current,
				title: nextTitle,
				summary: useTemplate(current.summary)
					? template.summary(theme)
					: current.summary,
				theory_text: useTemplate(current.theory_text)
					? template.theory(theme)
					: current.theory_text,
				key_points: useTemplate(current.key_points)
					? template.keyPoints
					: current.key_points,
				interactive_steps: useTemplate(current.interactive_steps)
					? template.steps
					: current.interactive_steps,
				task_title: useTemplate(current.task_title)
					? template.taskTitle(theme)
					: current.task_title,
				task_prompt: useTemplate(current.task_prompt)
					? template.taskPrompt(theme)
					: current.task_prompt,
				answer_keywords: useTemplate(current.answer_keywords)
					? template.keywords
					: current.answer_keywords,
				task_hints: useTemplate(current.task_hints)
					? template.hints
					: current.task_hints,
				starter_code:
					lessonPracticeMode === 'code' && useTemplate(current.starter_code)
						? template.starterCode
						: current.starter_code,
				duration_minutes: useTemplate(current.duration_minutes)
					? template.durationByAge[current.age_group]
					: current.duration_minutes,
				passing_score: useTemplate(current.passing_score)
					? template.passingScore
					: current.passing_score,
				task_xp_reward: useTemplate(current.task_xp_reward)
					? template.taskXpReward
					: current.task_xp_reward,
			}
		})
	}

	function applyLessonRecommendations() {
		const template = LESSON_BLUEPRINTS[lessonBlueprint]
		setLessonForm(current => ({
			...current,
			duration_minutes: template.durationByAge[current.age_group],
			passing_score: template.passingScore,
			task_xp_reward: template.taskXpReward,
			starter_code:
				lessonPracticeMode === 'code' && !current.starter_code.trim()
					? template.starterCode
					: current.starter_code,
			programming_language:
				lessonPracticeMode === 'code'
					? current.programming_language
					: defaultProgrammingLanguage(current.age_group),
			time_limit_ms: current.time_limit_ms.trim() || '2000',
			memory_limit_mb: current.memory_limit_mb.trim() || '128',
			judge_tests:
				lessonPracticeMode === 'code' &&
				current.evaluation_mode === 'stdin_stdout' &&
				current.judge_tests.length === 0
					? [createEmptyJudgeTest()]
					: current.judge_tests,
		}))
	}

	function resetLessonComposer() {
		const nextForm = buildEmptyLessonForm(
			lessonForm.age_group,
			lessonPracticeMode,
		)
		setLessonForm({
			...nextForm,
			duration_minutes:
				activeLessonBlueprint.durationByAge[lessonForm.age_group],
			passing_score: activeLessonBlueprint.passingScore,
			task_xp_reward: activeLessonBlueprint.taskXpReward,
			starter_code:
				lessonPracticeMode === 'code' ? activeLessonBlueprint.starterCode : '',
		})
	}

	async function loadJoinRequests(options: { silent?: boolean } = {}) {
		if (!options.silent) {
			setJoinRequestsLoading(true)
		}
		try {
			const data = await api<TeacherJoinRequestsResponse>(
				'/teacher/join-requests',
				undefined,
				'required',
			)
			setJoinRequests(data.requests)
		} finally {
			if (!options.silent) {
				setJoinRequestsLoading(false)
			}
		}
	}

	async function loadOverview() {
		const data = await api<TeacherOverviewData>(
			'/teacher/overview',
			undefined,
			'required',
		)
		setOverview(data)
		if (!selectedClassId && data.classes[0]) {
			setSelectedClassId(data.classes[0].id)
		}
	}

	async function loadCatalog(classroomId: number) {
		const data = await api<{ lessons: LessonCatalogItem[] }>(
			`/teacher/lesson-catalog?classroom_id=${classroomId}`,
			undefined,
			'required',
		)
		setCatalog(data.lessons)
	}

	async function loadClassDetails(classroomId: number) {
		const [detail, assignments, nextOverview] = await Promise.all([
			api<TeacherClassDetail>(
				`/teacher/classes/${classroomId}`,
				undefined,
				'required',
			),
			api<{ assignments: AssignmentItem[] }>(
				`/teacher/classes/${classroomId}/assignments`,
				undefined,
				'required',
			),
			api<TeacherOverviewData>('/teacher/overview', undefined, 'required'),
		])
		setClassDetail(detail)
		setAssignmentRows(assignments.assignments)
		setOverview(nextOverview)
		setSelectedAssignmentId(current => {
			if (
				current &&
				assignments.assignments.some(item => item.id === current)
			) {
				return current
			}
			return assignments.assignments[0]?.id ?? null
		})
	}

	async function loadSubmissions(assignmentId: number) {
		const [data, nextOverview] = await Promise.all([
			api<{ assignment: AssignmentItem; submissions: SubmissionItem[] }>(
				`/teacher/assignments/${assignmentId}/submissions`,
				undefined,
				'required',
			),
			api<TeacherOverviewData>('/teacher/overview', undefined, 'required'),
		])
		setSubmissions(data.submissions)
		setFeedbackDrafts(
			data.submissions.reduce<Record<number, string>>((acc, submission) => {
				acc[submission.id] = submission.feedback || ''
				return acc
			}, {}),
		)
		patchAssignmentStats(assignmentId, data.submissions)
		setOverview(nextOverview)
	}

	async function confirmJoinRequestDecision() {
		if (!joinRequestConfirm) return

		const { request: joinRequest, action } = joinRequestConfirm
		setJoinRequestSubmitting(true)
		try {
			await api(
				`/teacher/join-requests/${joinRequest.id}/${action === 'approve' ? 'approve' : 'reject'}`,
				{ method: 'POST' },
				'required',
			)
			showSuccessToast(
				action === 'approve'
					? 'Ученик добавлен в класс.'
					: 'Заявка отклонена.',
			)
			setJoinRequestConfirm(null)
			if (selectedClassId) {
				await Promise.all([loadJoinRequests(), loadClassDetails(selectedClassId)])
			} else {
				await Promise.all([loadJoinRequests(), loadOverview()])
			}
		} catch (error) {
			showErrorToast(
				error instanceof Error ? error.message : 'Не удалось обработать заявку.',
			)
		} finally {
			setJoinRequestSubmitting(false)
		}
	}

	useEffect(() => {
		if (initialOverview) return
		loadOverview().catch(() =>
			showErrorToast(
				'Не удалось загрузить кабинет учителя. Проверьте авторизацию и попробуйте снова.',
			),
		)
	}, [initialOverview])

	useEffect(() => {
		loadJoinRequests().catch(() =>
			showErrorToast('Не удалось загрузить заявки на вступление.'),
		)
		const intervalId = window.setInterval(() => {
			loadJoinRequests({ silent: true }).catch(() => undefined)
		}, 25000)
		return () => window.clearInterval(intervalId)
	}, [])

	useEffect(() => {
		if (!selectedClassId) {
			setCatalog([])
			setClassDetail(null)
			setAssignmentRows([])
			setSelectedAssignmentId(null)
			return
		}
		Promise.all([
			loadClassDetails(selectedClassId),
			loadCatalog(selectedClassId),
		]).catch(() => {
			showErrorToast('Не удалось загрузить уроки и задания выбранного класса.')
		})
	}, [selectedClassId])

	useEffect(() => {
		if (selectedAssignmentId) {
			loadSubmissions(selectedAssignmentId).catch((error) => {
				setSubmissions([])
				setFeedbackDrafts({})
				showErrorToast(
					getApiErrorMessage(
						error,
						'Не удалось загрузить ответы учеников по заданию.',
					),
				)
			})
			return
		}
		setSubmissions([])
		setFeedbackDrafts({})
	}, [selectedAssignmentId])

	async function createClass(event: FormEvent) {
		event.preventDefault()
		if (missingClassFields.length > 0) {
			showErrorToast(
				`Заполните обязательные поля: ${missingClassFields.map(field => CLASS_REQUIRED_FIELD_LABELS[field]).join(', ')}.`,
			)
			return
		}

		try {
			await api(
				'/teacher/classes',
				{
					method: 'POST',
					body: JSON.stringify({
						name: classForm.name.trim(),
						description: classForm.description.trim(),
					}),
				},
				'required',
			)
			setClassForm({ name: '', description: '' })
			showSuccessToast('Класс создан.')
			await loadOverview()
		} catch (error) {
			showErrorToast(error instanceof Error ? error.message : 'Не удалось создать класс.')
		}
	}

	async function createAssignment(event: FormEvent) {
		event.preventDefault()
		if (!selectedClassId) {
			showErrorToast('Сначала выберите класс, для которого создается задание.')
			return
		}
		if (missingAssignmentFields.length > 0) {
			showErrorToast(
				`Заполните обязательные поля: ${missingAssignmentFieldLabels.join(', ')}.`,
			)
			return
		}
		try {
			await api(
				`/teacher/classes/${selectedClassId}/assignments`,
				{
					method: 'POST',
					body: JSON.stringify({
						...assignmentForm,
						lesson_id: Number(assignmentForm.lesson_id),
					}),
				},
				true,
			)
			setAssignmentForm(current => ({
				...EMPTY_ASSIGNMENT_FORM,
				assignment_type: current.assignment_type,
				submission_format: current.submission_format,
				lesson_id: current.lesson_id,
			}))
			showSuccessToast('Задание назначено классу.')
			await loadClassDetails(selectedClassId)
		} catch (error) {
			showErrorToast(error instanceof Error ? error.message : 'Не удалось назначить задание классу.')
		}
	}

	async function gradeSubmission(
		submissionId: number,
		status: 'checked' | 'needs_revision',
		currentScore: number,
		currentFeedback?: string | null,
	) {
		try {
			await api(
				`/teacher/submissions/${submissionId}/grade`,
				{
					method: 'PATCH',
					body: JSON.stringify({
						score: currentScore,
						feedback:
							currentFeedback ||
							(status === 'checked'
								? 'Урок выполнен верно.'
								: 'Нужно доработать и отправить ещё раз.'),
						status,
					}),
				},
				true,
			)
			showSuccessToast(
				status === 'checked'
					? 'Урок отмечен как выполненный.'
					: 'Урок отправлен на доработку.',
			)
			if (selectedAssignmentId) {
				await Promise.all([
					loadSubmissions(selectedAssignmentId),
					...(selectedClassId
						? [loadClassDetails(selectedClassId)]
						: []),
				])
			}
		} catch (error) {
			showErrorToast(error instanceof Error ? error.message : 'Не удалось обновить статус сдачи.')
		}
	}

	return (
		<div className='teacher-workspace space-y-6'>
			<Link
				href={createLessonHref}
				className='teacher-create-button fixed right-4 top-24 z-40 inline-flex min-h-12 items-center justify-center rounded-full bg-sky-600 px-5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(14,165,233,0.28)] transition hover:-translate-y-0.5 hover:bg-sky-700 hover:shadow-[0_20px_44px_rgba(14,165,233,0.34)] sm:right-6 lg:right-8 2xl:right-[max(2rem,calc((100vw-96rem)/2+2rem))]'
			>
				Создать урок
			</Link>
			<section className='teacher-workspace__layout grid gap-6 xl:grid-cols-[0.92fr_1.08fr]'>
				<div className='space-y-6'>
					<form
						onSubmit={createClass}
						className='teacher-workspace__panel codequest-card p-6'
					>
						<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
							Новый класс
						</p>
						<div className='mt-4 space-y-3'>
							<input
								required
								aria-invalid={missingClassFields.includes('name')}
								className={`w-full rounded-2xl border px-4 py-3 ${missingClassFields.includes('name') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								placeholder='Название класса'
								value={classForm.name}
								onChange={e =>
									setClassForm({ ...classForm, name: e.target.value })
								}
							/>
							{missingClassFields.includes('name') ? (
								<p className='text-sm font-semibold text-rose-600'>
									Введите название класса.
								</p>
							) : null}
							<textarea
								className='min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3'
								placeholder='Описание'
								value={classForm.description}
								onChange={e =>
									setClassForm({ ...classForm, description: e.target.value })
								}
							/>
							<button
								disabled={!canCreateClass}
								className='w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
							>
								Создать класс
							</button>
						</div>
					</form>

					<div className='teacher-workspace__panel codequest-card p-6'>
						<div className='flex flex-wrap items-center justify-between gap-3'>
							<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
								Мои классы
							</p>
						</div>
						<div className='mt-4 space-y-3'>
							{overview?.classes.map(item => (
								<div
									key={item.id}
									className={`teacher-workspace__item rounded-2xl border px-4 py-4 ${selectedClassId === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800'}`}
								>
									<div className='flex flex-wrap items-start justify-between gap-3'>
										<button
											type='button'
											onClick={() => setSelectedClassId(item.id)}
											className='min-w-0 flex-1 text-left'
										>
											<p className='break-words text-lg font-black'>
												{item.name}
											</p>
											<p
												className={`mt-2 text-sm ${selectedClassId === item.id ? 'text-slate-300' : 'text-slate-500'}`}
											>
												Код входа:
											</p>
											<p
												className={`break-all font-mono text-sm font-semibold ${selectedClassId === item.id ? 'text-white' : 'text-slate-700'}`}
											>
												{item.code}
											</p>
										</button>
										<div className='flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end'>
											<span
												className={`rounded-full px-3 py-1 text-xs font-bold ${selectedClassId === item.id ? 'bg-white text-slate-900' : 'bg-sky-50 text-sky-700'}`}
											>
												{item.students_count} учен.
											</span>
											<button
												type='button'
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

					<section className='teacher-workspace__panel codequest-card p-6'>
						<div className='flex flex-wrap items-center justify-between gap-3'>
							<div className='min-w-0'>
								<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
									Заявки на вступление
								</p>
								<h2 className='mt-2 break-words text-2xl font-black text-slate-900'>
									{joinRequests.length
										? `${joinRequests.length} ожидают решения`
										: 'Новых заявок нет'}
								</h2>
							</div>
							<button
								type='button'
								onClick={() =>
									loadJoinRequests().catch(() =>
										showErrorToast('Не удалось обновить заявки.'),
									)
								}
								className='rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700'
							>
								Обновить
							</button>
						</div>

						<div className='mt-5 space-y-3'>
							{joinRequestsLoading && joinRequests.length === 0 ? (
								<div className='rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500'>
									Загружаем заявки...
								</div>
							) : joinRequests.length ? (
								joinRequests.map(joinRequest => (
									<div
										key={joinRequest.id}
										className='teacher-workspace__item rounded-2xl border border-slate-200 bg-slate-50 p-4'
									>
										<div className='flex flex-wrap items-start justify-between gap-3'>
											<div className='min-w-0'>
												<p className='break-words text-lg font-black text-slate-900'>
													{getJoinRequestStudentName(joinRequest)}
												</p>
												<p className='mt-1 text-sm text-slate-500'>
													{joinRequest.classroom_name || 'класс без названия'}
												</p>
												<p className='mt-1 text-xs font-semibold text-slate-500'>
													Отправлена{' '}
													<UserLocalTime
														iso={joinRequest.created_at}
														variant='joinRequest'
														invalidLabel='дата не указана'
													/>
												</p>
											</div>
											<div className='flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end'>
												<button
													type='button'
													onClick={() =>
														setJoinRequestConfirm({
															request: joinRequest,
															action: 'approve',
														})
													}
													className='rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white'
												>
													Принять
												</button>
												<button
													type='button'
													onClick={() =>
														setJoinRequestConfirm({
															request: joinRequest,
															action: 'reject',
														})
													}
													className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm'
												>
													Отклонить
												</button>
											</div>
										</div>
									</div>
								))
							) : (
								<div className='rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500'>
									Когда ученик введёт код класса, его заявка появится здесь.
								</div>
							)}
						</div>
					</section>

					<section className='teacher-workspace__panel codequest-card p-6'>
						<div className='flex flex-wrap items-center justify-between gap-3'>
							<div className='min-w-0'>
								<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
									Ученики класса
								</p>
								<h2 className='mt-2 break-words text-2xl font-black text-slate-900'>
									{selectedClass?.name || 'Список появится после выбора класса'}
								</h2>
							</div>
							{selectedClass && (
								<span className='rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700'>
									{classDetail?.students.length || 0} учен.
								</span>
							)}
						</div>
						<p className='mt-3 text-sm leading-6 text-slate-600'>
							{selectedClass
								? 'Быстрый просмотр состава класса и прогресса учеников.'
								: 'Выберите класс выше, чтобы увидеть учеников и их прогресс.'}
						</p>

						<div className='mt-5 space-y-3'>
							{classDetail?.students.length ? (
								classDetail.students.map(student => (
									<div
										key={student.id}
										className='teacher-workspace__item rounded-2xl border border-slate-200 bg-slate-50 p-4'
									>
										<div className='flex flex-wrap items-start justify-between gap-3'>
											<div>
												<p className='text-lg font-black text-slate-900'>
													{student.full_name}
												</p>
												<p className='text-sm text-slate-500'>
													{student.email}
												</p>
											</div>
											<span className='rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700'>
												XP {student.xp}
											</span>
										</div>
										<div className='mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600'>
											<span className='rounded-full bg-white px-3 py-1'>
												Уровень {student.level}
											</span>
											<span className='rounded-full bg-white px-3 py-1'>
												Уроков {student.completed_lessons}
											</span>
											<span className='rounded-full bg-white px-3 py-1'>
												Средний балл {student.average_score}%
											</span>
										</div>
									</div>
								))
							) : (
								<div className='rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500'>
									В выбранном классе пока нет учеников.
								</div>
							)}
						</div>
					</section>
				</div>

				<div className='space-y-6'>
					<section className='teacher-workspace__panel codequest-card p-6'>
						<div className='flex flex-wrap items-center justify-between gap-3'>
							<div className='min-w-0'>
								<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
									Выбранный класс
								</p>
								<h2 className='mt-2 break-words text-2xl font-black text-slate-900 sm:text-3xl'>
									{selectedClass?.name || 'Выберите класс'}
								</h2>
							</div>
							{selectedClass && (
								<div className='flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end'>
									<span className='max-w-full rounded-full bg-slate-900 px-4 py-2 font-mono text-sm font-semibold text-white break-all'>
										Код {selectedClass.code}
									</span>
									<button
										type='button'
										onClick={() => handleCopyClassCode(selectedClass.code)}
										className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm'
									>
										Копировать
									</button>
								</div>
							)}
						</div>
						<p className='mt-3 text-slate-600'>
							{classDetail?.classroom.description ||
								'Выберите класс, чтобы назначать уроки и проверять работы.'}
						</p>

						<div className='mt-5 grid gap-3 sm:grid-cols-3'>
							<div className='rounded-2xl border border-slate-200 bg-slate-50 p-4'>
								<p className='text-xs font-bold uppercase tracking-[0.16em] text-slate-500'>
									Учеников
								</p>
								<p className='mt-2 text-3xl font-black text-slate-900'>
									{classDetail?.students.length || 0}
								</p>
							</div>
							<div className='rounded-2xl border border-slate-200 bg-slate-50 p-4'>
								<p className='text-xs font-bold uppercase tracking-[0.16em] text-slate-500'>
									Заданий
								</p>
								<p className='mt-2 text-3xl font-black text-slate-900'>
									{assignmentRows.length}
								</p>
							</div>
							<div className='rounded-2xl border border-slate-200 bg-slate-50 p-4'>
								<p className='text-xs font-bold uppercase tracking-[0.16em] text-slate-500'>
									Проверено
								</p>
								<p className='mt-2 text-3xl font-black text-slate-900'>
									{reviewedCount}
								</p>
							</div>
						</div>
						{classDetail?.practice_heatmap?.assignments.length ? (
							<div className='mt-4 border-t border-slate-100 pt-3'>
								<div className='flex flex-wrap items-center justify-between gap-2 gap-y-1 text-xs text-slate-500'>
									<span className='font-medium text-slate-600'>
										Практика: ошибки
									</span>
									<span className='text-right'>
										{classDetail.practice_heatmap.summary.reviewed > 0 ? (
											<>
												{classDetail.practice_heatmap.summary.failed} из{' '}
												{classDetail.practice_heatmap.summary.reviewed}{' '}
												проверено
												{classDetail.practice_heatmap.summary.failure_rate !=
													null && (
													<>
														{' '}
														(
														{
															classDetail.practice_heatmap.summary
																.failure_rate
														}
														% неверно)
													</>
												)}
											</>
										) : (
											<>проверенных сдач пока нет</>
										)}
									</span>
								</div>
								<div
									className='mt-2 flex max-w-full gap-px overflow-x-auto pb-0.5'
									role='list'
									aria-label='Доля ошибок по заданиям практики'
								>
									{classDetail.practice_heatmap.assignments.map(row => (
										<button
											key={row.assignment_id}
											type='button'
											role='listitem'
											title={`${row.title}\nНеверно: ${row.failed}, проверено: ${row.reviewed}${
												row.failure_rate != null
													? ` (${row.failure_rate}%)`
													: ''
											}\nНажмите, чтобы открыть сдачи`}
											onClick={() =>
												setSelectedAssignmentId(row.assignment_id)
											}
											className='min-h-6 min-w-[8px] flex-1 rounded-sm transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 sm:max-w-[100px]'
											style={{
												backgroundColor: practiceHeatSegmentColor(
													row.failure_rate,
													row.reviewed,
												),
											}}
										/>
									))}
								</div>
							</div>
						) : null}
					</section>

					<section className='teacher-workspace__panel codequest-card p-6'>
						<div className='flex flex-wrap items-center justify-between gap-3'>
							<div>
								<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
									Уроки класса
								</p>
								<h3 className='mt-2 text-2xl font-black text-slate-900'>
									Библиотека + авторские уроки
								</h3>
							</div>
							<div className='flex flex-wrap items-center gap-2'>
								<span className='rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700'>
									{catalog.length} уроков доступно
								</span>
								<span className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600'>
									Стр. {lessonPage} из {totalLessonPages}
								</span>
							</div>
						</div>

						<div className='mt-5 grid gap-3 md:grid-cols-2'>
							{paginatedLessons.map(lesson => (
								<div
									key={lesson.id}
									className={`teacher-workspace__item rounded-2xl border p-4 ${lesson.source === 'teacher' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}
								>
									<div className='flex flex-wrap items-start justify-between gap-3'>
										<div>
											<p className='text-lg font-black text-slate-900'>
												{lesson.title}
											</p>
											<p className='mt-1 text-sm text-slate-500'>
												{lesson.module_title}
											</p>
										</div>
										<span
											className={`rounded-full px-3 py-1 text-xs font-bold ${lesson.source === 'teacher' ? 'bg-white text-emerald-700' : 'bg-white text-sky-700'}`}
										>
											{lesson.source_label}
										</span>
									</div>
									<p className='mt-3 text-sm leading-6 text-slate-600'>
										{shortenText(lesson.summary, 150)}
									</p>
									<div className='mt-4 flex flex-wrap gap-2'>
										<button
											type='button'
											onClick={() => selectLessonForAssignment(lesson)}
											className='rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white'
										>
											Выбрать для задания
										</button>
										<Link
											href={
												selectedClassId
													? `/teacher/lessons/create?classId=${selectedClassId}&fromLessonId=${lesson.id}`
													: `/teacher/lessons/create?fromLessonId=${lesson.id}`
											}
											className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700'
										>
											Взять за основу
										</Link>
										<Link
											href={`/lessons/${lesson.id}`}
											className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700'
										>
											Открыть урок
										</Link>
									</div>
								</div>
							))}
						</div>

						{totalLessonPages > 1 && (
							<div className='mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3'>
								<p className='text-sm text-slate-600'>
									Показываем по {LESSONS_PER_PAGE} урока на страницу.
								</p>
								<div className='flex flex-wrap gap-2'>
									<button
										type='button'
										onClick={() =>
											setLessonPage(current => Math.max(1, current - 1))
										}
										disabled={lessonPage === 1}
										className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50'
									>
										Назад
									</button>
									<button
										type='button'
										onClick={() =>
											setLessonPage(current =>
												Math.min(totalLessonPages, current + 1),
											)
										}
										disabled={lessonPage === totalLessonPages}
										className='rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
									>
										Вперёд
									</button>
								</div>
							</div>
						)}
					</section>
					<form
						id='assignment-builder'
						onSubmit={createAssignment}
						className='teacher-workspace__panel codequest-card p-6'
					>
						<div className='flex flex-wrap items-center justify-between gap-3'>
							<div>
								<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
									Назначить задание
								</p>
								<h3 className='mt-2 text-2xl font-black text-slate-900'>
									Конструктор заданий
								</h3>
							</div>
							<span className='rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700'>
								3 шага: тип → параметры → критерии
							</span>
						</div>

						<p className='mt-5 text-sm font-bold uppercase tracking-[0.18em] text-slate-500'>
							1. Вид задания
						</p>
						<div className='mt-3 grid gap-3 md:grid-cols-2'>
							{ASSIGNMENT_TYPES.map(type => (
								<button
									key={type}
									type='button'
									onClick={() =>
										setAssignmentForm(current => ({
											...current,
											assignment_type: type,
											submission_format:
												ASSIGNMENT_TEMPLATES[type].submission_format,
										}))
									}
									className={`teacher-workspace__item rounded-2xl border p-4 text-left transition ${assignmentForm.assignment_type === type ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
								>
									<p className='text-base font-black text-slate-900'>
										{ASSIGNMENT_TEMPLATES[type].label}
									</p>
									<p className='mt-2 text-sm leading-6 text-slate-600'>
										{ASSIGNMENT_TEMPLATES[type].short}
									</p>
								</button>
							))}
						</div>

						<div className='mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600'>
							<p className='font-semibold text-slate-800'>
								Выбран тип:{' '}
								{ASSIGNMENT_TEMPLATES[assignmentForm.assignment_type].label}
							</p>
							<p className='mt-1'>
								Рекомендованный формат сдачи:{' '}
								{SUBMISSION_FORMAT_LABELS[assignmentForm.submission_format]}
							</p>
							{selectedLessonForAssignment && (
								<p className='mt-1'>
									Привязан урок: {selectedLessonForAssignment.title}
								</p>
							)}
						</div>
						{!canCreateAssignment ? (
							<div className='mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'>
								{selectedClassId ? (
									<p>
										Чтобы создать задание, заполните все обязательные поля и
										обязательно выберите урок.
									</p>
								) : (
									<p>Сначала выберите класс, а затем заполните форму задания.</p>
								)}
							</div>
						) : null}

						<p className='mt-6 text-sm font-bold uppercase tracking-[0.18em] text-slate-500'>
							2. Основные параметры
						</p>
						<div className='mt-3 grid gap-3 md:grid-cols-2'>
							<input
								required
								aria-invalid={missingAssignmentFields.includes('title')}
								className={`rounded-2xl border px-4 py-3 ${missingAssignmentFields.includes('title') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								placeholder='Название задания'
								value={assignmentForm.title}
								onChange={e =>
									setAssignmentForm({
										...assignmentForm,
										title: e.target.value,
									})
								}
							/>
							<select
								required
								aria-invalid={missingAssignmentFields.includes('lesson_id')}
								className={`rounded-2xl border px-4 py-3 ${missingAssignmentFields.includes('lesson_id') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								value={assignmentForm.lesson_id}
								onChange={e =>
									setAssignmentForm({
										...assignmentForm,
										lesson_id: e.target.value,
									})
								}
							>
								<option value=''>Выберите урок для задания</option>
								{catalog.map(lesson => (
									<option key={lesson.id} value={lesson.id}>
										[{lesson.source === 'teacher' ? 'Ваш урок' : 'Каталог'}]{' '}
										{lesson.title}
									</option>
								))}
							</select>
							<input
								required
								aria-invalid={missingAssignmentFields.includes('due_date')}
								className={`rounded-2xl border px-4 py-3 ${missingAssignmentFields.includes('due_date') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								type='date'
								value={assignmentForm.due_date}
								onChange={e =>
									setAssignmentForm({
										...assignmentForm,
										due_date: e.target.value,
									})
								}
							/>
							<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
								<select
									className='rounded-2xl border border-slate-200 px-4 py-3'
									value={assignmentForm.difficulty}
									onChange={e =>
										setAssignmentForm({
											...assignmentForm,
											difficulty: e.target.value as Difficulty,
										})
									}
								>
									<option value='easy'>easy</option>
									<option value='medium'>medium</option>
									<option value='hard'>hard</option>
								</select>
								<select
									className='rounded-2xl border border-slate-200 px-4 py-3'
									value={assignmentForm.submission_format}
									onChange={e =>
										setAssignmentForm({
											...assignmentForm,
											submission_format: e.target.value as SubmissionFormat,
										})
									}
								>
									{SUBMISSION_FORMAT_OPTIONS.map(item => (
										<option key={item.value} value={item.value}>
											{item.label}
										</option>
									))}
								</select>
							</div>
						</div>
						<p className='mt-3 text-sm text-slate-500'>
							За задания учителя XP не начисляется. Учитель проверяет ответ
							вручную.
						</p>

						<p className='mt-6 text-sm font-bold uppercase tracking-[0.18em] text-slate-500'>
							3. Содержание и ожидания
						</p>
						<div className='mt-3 grid gap-3 md:grid-cols-2'>
							<textarea
								required
								aria-invalid={missingAssignmentFields.includes('learning_goal')}
								className={`min-h-24 rounded-2xl border px-4 py-3 ${missingAssignmentFields.includes('learning_goal') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								placeholder='Цель обучения'
								value={assignmentForm.learning_goal}
								onChange={e =>
									setAssignmentForm({
										...assignmentForm,
										learning_goal: e.target.value,
									})
								}
							/>
							<textarea
								required
								aria-invalid={missingAssignmentFields.includes('resources')}
								className={`min-h-24 rounded-2xl border px-4 py-3 ${missingAssignmentFields.includes('resources') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								placeholder='Материалы и ссылки (каждая строка отдельно)'
								value={assignmentForm.resources}
								onChange={e =>
									setAssignmentForm({
										...assignmentForm,
										resources: e.target.value,
									})
								}
							/>
							<textarea
								required
								aria-invalid={missingAssignmentFields.includes('work_steps')}
								className={`min-h-28 rounded-2xl border px-4 py-3 ${missingAssignmentFields.includes('work_steps') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								placeholder='Шаги выполнения (каждый шаг с новой строки)'
								value={assignmentForm.work_steps}
								onChange={e =>
									setAssignmentForm({
										...assignmentForm,
										work_steps: e.target.value,
									})
								}
							/>
							<textarea
								required
								aria-invalid={missingAssignmentFields.includes('success_criteria')}
								className={`min-h-28 rounded-2xl border px-4 py-3 ${missingAssignmentFields.includes('success_criteria') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								placeholder='Критерии успеха (каждый пункт с новой строки)'
								value={assignmentForm.success_criteria}
								onChange={e =>
									setAssignmentForm({
										...assignmentForm,
										success_criteria: e.target.value,
									})
								}
							/>
							<textarea
								required
								aria-invalid={missingAssignmentFields.includes('description')}
								className={`min-h-28 rounded-2xl border px-4 py-3 md:col-span-2 ${missingAssignmentFields.includes('description') ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
								placeholder='Описание задания'
								value={assignmentForm.description}
								onChange={e =>
									setAssignmentForm({
										...assignmentForm,
										description: e.target.value,
									})
								}
							/>
						</div>

						<div className='mt-4 flex flex-wrap gap-2'>
							<button
								type='button'
								onClick={() =>
									applyAssignmentTemplate(assignmentForm.assignment_type, true)
								}
								className='rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700'
							>
								Заполнить шаблон под выбранный тип
							</button>
							<button
								type='button'
								onClick={() =>
									applyAssignmentTemplate(assignmentForm.assignment_type)
								}
								className='rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700'
							>
								Дополнить пустые поля
							</button>
							<button
								disabled={!canCreateAssignment}
								className='rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
							>
								Добавить задание
							</button>
						</div>
					</form>

					<section className='grid gap-6 xl:grid-cols-[0.9fr_1.1fr]'>
						<div className='teacher-workspace__panel codequest-card p-6'>
							<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
								Задания класса
							</p>
							<div className='mt-4 space-y-3'>
								{assignmentRows.map(assignment => (
									<button
										key={assignment.id}
										type='button'
										onClick={() => setSelectedAssignmentId(assignment.id)}
										className={`teacher-workspace__item w-full rounded-2xl border px-4 py-4 text-left ${selectedAssignmentId === assignment.id ? 'border-sky-600 bg-sky-50' : 'border-slate-200 bg-white'}`}
									>
										<div className='flex flex-wrap items-start justify-between gap-3'>
											<div>
												<p className='font-black text-slate-900'>
													{assignment.title}
												</p>
												<p className='mt-1 text-sm text-slate-500'>
													{assignment.assignment_type_label} ·{' '}
													{assignment.difficulty} · дедлайн{' '}
													{assignment.due_date || 'без срока'}
												</p>
											</div>
											<div className='flex flex-wrap items-center gap-2'>
												{assignment.lesson && (
													<span className='rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-700'>
														{assignment.lesson.title}
													</span>
												)}
												<span className='rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700'>
													{
														SUBMISSION_FORMAT_LABELS[
															assignment.submission_format
														]
													}
												</span>
											</div>
										</div>
										<p className='mt-2 text-xs font-semibold text-slate-600'>
											Сдач: {assignment.submissions_count || 0} · Проверено:{' '}
											{assignment.checked_count || 0}
										</p>
									</button>
								))}
							</div>
						</div>

						<div className='teacher-workspace__panel codequest-card p-6'>
							<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
								Проверка сдач
							</p>
							<div className='mt-4 space-y-4'>
								{submissions.map(submission => (
									<div
										key={submission.id}
										className='teacher-workspace__item rounded-2xl border border-slate-200 bg-slate-50 p-4'
									>
										<div className='flex flex-wrap items-start justify-between gap-3'>
											<div>
												<p className='text-lg font-black text-slate-900'>
													{submission.student_full_name || `Ученик #${submission.student_id}`}
												</p>
												<p className='text-sm text-slate-500'>
													<UserLocalTime iso={submission.submitted_at} variant='submission' />
												</p>
											</div>
											<div className='flex flex-wrap items-center gap-2'>
												<span
													className={`rounded-full px-3 py-1 text-sm font-semibold ${
														submission.status === 'checked'
															? 'bg-emerald-100 text-emerald-700'
															: submission.status === 'needs_revision'
																? 'bg-amber-100 text-amber-700'
																: 'bg-sky-100 text-sky-700'
													}`}
												>
													{SUBMISSION_STATUS_LABELS[submission.status]}
												</span>
												<span className='rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700'>
													{submission.score}%
												</span>
											</div>
										</div>
										<pre className='mt-3 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-emerald-200'>
											{submission.answer ||
												'Ученик пока не приложил текст ответа.'}
										</pre>
										<textarea
											value={feedbackDrafts[submission.id] ?? ''}
											onChange={e =>
												setFeedbackDrafts(current => ({
													...current,
													[submission.id]: e.target.value,
												}))
											}
											className='mt-3 min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3'
											placeholder='Комментарий ученику'
										/>
										<div className='mt-3 flex flex-wrap gap-2'>
											<button
												type='button'
												onClick={() =>
													gradeSubmission(
														submission.id,
														'checked',
														submission.score,
														feedbackDrafts[submission.id],
													)
												}
												className='rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white'
											>
												Верно
											</button>
											<button
												type='button'
												onClick={() =>
													gradeSubmission(
														submission.id,
														'needs_revision',
														submission.score,
														feedbackDrafts[submission.id],
													)
												}
												className='rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white'
											>
												Неверно
											</button>
										</div>
									</div>
								))}
								{selectedAssignmentId && submissions.length === 0 && (
									<p className='text-sm text-slate-500'>
										У этого задания пока нет сдач.
									</p>
								)}
							</div>
						</div>
					</section>
				</div>
			</section>
			{joinRequestConfirm ? (
				<div
					className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm'
					role='dialog'
					aria-modal='true'
					aria-labelledby='join-request-confirm-title'
				>
					<div className='w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl'>
						<p className='text-sm font-bold uppercase tracking-[0.2em] text-emerald-600'>
							Подтверждение
						</p>
						<h2
							id='join-request-confirm-title'
							className='mt-2 text-2xl font-black text-slate-900'
						>
							{joinRequestConfirm.action === 'approve'
								? 'Принять ученика?'
								: 'Отклонить заявку?'}
						</h2>
						<p className='mt-3 text-sm leading-6 text-slate-600'>
							{joinRequestConfirm.action === 'approve'
								? `Ученик ${getJoinRequestStudentName(joinRequestConfirm.request)} будет добавлен в класс «${joinRequestConfirm.request.classroom_name || 'без названия'}».`
								: `Заявка ученика ${getJoinRequestStudentName(joinRequestConfirm.request)} в класс «${joinRequestConfirm.request.classroom_name || 'без названия'}» будет отклонена.`}
						</p>
						<div className='mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end'>
							<button
								type='button'
								onClick={() => setJoinRequestConfirm(null)}
								disabled={joinRequestSubmitting}
								className='rounded-full bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60'
							>
								Отмена
							</button>
							<button
								type='button'
								onClick={confirmJoinRequestDecision}
								disabled={joinRequestSubmitting}
								className={`rounded-full px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
									joinRequestConfirm.action === 'approve'
										? 'bg-emerald-600'
										: 'bg-rose-600'
								}`}
							>
								{joinRequestSubmitting
									? 'Сохраняем...'
									: joinRequestConfirm.action === 'approve'
										? 'Да, принять'
										: 'Да, отклонить'}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	)
}
