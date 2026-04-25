'use client'

import { useAppTheme } from '@/hooks/use-app-theme'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { LessonNotFoundPanel } from '@/components/lesson-not-found-panel'
import { ApiError, api, getApiErrorMessage } from '@/lib/api'
import { queueMascotScenario } from '@/lib/mascot'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'
import {
	ageGroupSupportsCodePractice,
	hasMovementTarget,
	hasQuizReviewData,
	isQuestionAnswered,
	lessonStatusLabel,
	moveItemAroundFixed,
	normalizeLessonPayload,
	normalizeQuizText,
	toNumberArray,
	toStringArray,
	toStringRecord,
} from '@/components/lesson-player-helpers'
import type { LessonPlayerPayload } from '@/components/lesson-player-helpers'
import {
	JudgeReport,
	LessonDetail,
	ProgressItem,
	QuizItem,
	QuizQuestion,
} from '@/types'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

export type { LessonPlayerPayload } from '@/components/lesson-player-helpers'

function LessonCodeEditorFallback() {
	const theme = useAppTheme()
	const shellClass =
		theme === 'dark'
			? 'border-slate-700/80 bg-slate-950/90 shadow-[0_20px_48px_rgba(2,6,23,0.45)]'
			: 'border-slate-200/90 bg-white/95 shadow-[0_20px_40px_rgba(15,23,42,0.08)]'
	const surfaceClass =
		theme === 'dark'
			? 'bg-[#0b1220] text-slate-400'
			: 'bg-[#f8fbff] text-slate-500'

	return (
		<div className={`h-[420px] w-full rounded-[24px] border p-3 ${shellClass}`}>
			<div
				className={`flex h-full items-center justify-center rounded-[20px] text-sm font-medium ${surfaceClass}`}
			>
				Загружаем редактор…
			</div>
		</div>
	)
}

const LazyLessonCodeEditor = dynamic(
	() =>
		import('@/components/lesson-code-editor').then(mod => mod.LessonCodeEditor),
	{
		ssr: false,
		loading: () => <LessonCodeEditorFallback />,
	},
)

const LazyLessonGigachatDrawer = dynamic(
	() =>
		import('@/components/lesson-gigachat-drawer').then(
			mod => mod.LessonGigachatDrawer,
		),
	{ ssr: false, loading: () => null },
)

type ViewerRole = 'student' | 'teacher' | 'admin' | 'superadmin'

function OrderQuestion({
	question,
	value,
	onChange,
	locked = false,
	reviewActive = false,
}: {
	question: QuizQuestion
	value: string[]
	onChange: (next: string[]) => void
	locked?: boolean
	reviewActive?: boolean
}) {
	const correctOrder = toStringArray(question.correct)
	const items = value.length ? value : [...(question.items || [])]
	const fixedIndexes = new Set(
		reviewActive
			? items.reduce<number[]>((acc, item, index) => {
					if (correctOrder[index] === item) {
						acc.push(index)
					}
					return acc
				}, [])
			: [],
	)

	useEffect(() => {
		if (locked || reviewActive) return
		if (!value.length && question.items?.length) {
			onChange([...(question.items || [])])
		}
	}, [locked, onChange, question.items, reviewActive, value.length])

	return (
		<div className='space-y-3'>
			{items.map((item, index) =>
				(() => {
					const isCorrectStep = correctOrder[index] === item
					const isCorrectReviewStep = (reviewActive || locked) && isCorrectStep
					const isWrongStep = (reviewActive || locked) && !isCorrectStep
					const lockStep = locked || isCorrectReviewStep
					const canMoveUp =
						!lockStep &&
						hasMovementTarget(items.length, index, -1, fixedIndexes)
					const canMoveDown =
						!lockStep && hasMovementTarget(items.length, index, 1, fixedIndexes)

					return (
						<div
							key={`${item}-${index}`}
							className={`flex items-center justify-between rounded-[22px] border px-4 py-3 ${
								isCorrectReviewStep
									? 'border-emerald-200 bg-emerald-50'
									: isWrongStep
										? 'border-rose-200 bg-rose-50'
										: 'border-slate-200 bg-white'
							}`}
						>
							<div>
								<p
									className={`text-xs font-bold uppercase tracking-[0.16em] ${
										isCorrectReviewStep
											? 'text-emerald-600'
											: isWrongStep
												? 'text-rose-600'
												: 'text-slate-400'
									}`}
								>
									Шаг {index + 1}
								</p>
								<p
									className={`font-semibold ${
										isCorrectReviewStep
											? 'text-emerald-900'
											: isWrongStep
												? 'text-rose-900'
												: 'text-slate-900'
									}`}
								>
									{item}
								</p>
							</div>
							<div className='flex gap-2'>
								<button
									type='button'
									className={`rounded-full px-3 py-2 text-xs font-bold ${
										isCorrectReviewStep
											? 'bg-emerald-100 text-emerald-700'
											: isWrongStep
												? 'bg-rose-100 text-rose-700'
												: 'bg-slate-100 text-slate-700'
									}`}
									disabled={!canMoveUp}
									onClick={() =>
										onChange(
											moveItemAroundFixed(items, index, -1, fixedIndexes),
										)
									}
								>
									↑
								</button>
								<button
									type='button'
									className={`rounded-full px-3 py-2 text-xs font-bold ${
										isCorrectReviewStep
											? 'bg-emerald-100 text-emerald-700'
											: isWrongStep
												? 'bg-rose-100 text-rose-700'
												: 'bg-slate-100 text-slate-700'
									}`}
									disabled={!canMoveDown}
									onClick={() =>
										onChange(moveItemAroundFixed(items, index, 1, fixedIndexes))
									}
								>
									↓
								</button>
							</div>
						</div>
					)
				})(),
			)}
		</div>
	)
}

function MatchQuestion({
	question,
	value,
	onChange,
	locked = false,
	reviewActive = false,
}: {
	question: QuizQuestion
	value: Record<string, string>
	onChange: (next: Record<string, string>) => void
	locked?: boolean
	reviewActive?: boolean
}) {
	const left = question.left || []
	const right = question.right || []
	const reviewPairs = toStringRecord(question.correct)
	const currentValue = value

	return (
		<div className='grid gap-3'>
			{left.map(item =>
				(() => {
					const isCorrectPair =
						Boolean(currentValue[item]) &&
						currentValue[item] === reviewPairs[item]
					const isWrongPair =
						(reviewActive || locked) &&
						Boolean(currentValue[item]) &&
						currentValue[item] !== reviewPairs[item]
					const isFixedCorrectPair = (reviewActive || locked) && isCorrectPair

					return (
						<div
							key={item}
							className={`grid gap-3 rounded-[22px] border p-4 md:grid-cols-[1fr_220px] md:items-center ${
								isFixedCorrectPair
									? 'border-emerald-200 bg-emerald-50'
									: isWrongPair
										? 'border-rose-200 bg-rose-50'
										: 'border-slate-200 bg-white'
							}`}
						>
							<div>
								<p
									className={`font-semibold ${
										isFixedCorrectPair
											? 'text-emerald-900'
											: isWrongPair
												? 'text-rose-900'
												: 'text-slate-900'
									}`}
								>
									{item}
								</p>
							</div>
							<select
								className={`w-full rounded-[18px] border px-4 py-3 ${
									isFixedCorrectPair
										? 'border-emerald-300 bg-emerald-100 text-emerald-900'
										: isWrongPair
											? 'border-rose-300 bg-rose-100 text-rose-900'
											: 'border-slate-200 bg-slate-50'
								}`}
								disabled={locked || isFixedCorrectPair}
								value={currentValue[item] || ''}
								onChange={e => onChange({ ...value, [item]: e.target.value })}
							>
								<option value=''>Выбери пару</option>
								{right.map(option => (
									<option key={option} value={option}>
										{option}
									</option>
								))}
							</select>
						</div>
					)
				})(),
			)}
		</div>
	)
}

function QuestionCard({
	question,
	value,
	onChange,
	number,
	locked = false,
	reviewActive = false,
}: {
	question: QuizQuestion
	value: unknown
	onChange: (next: unknown) => void
	number: number
	locked?: boolean
	reviewActive?: boolean
}) {
	const multipleValue = toNumberArray(value)
	const correctIndexes = toNumberArray(question.correct)
	const acceptedAnswers = toStringArray(question.correct)
	const textValue = typeof value === 'string' ? value : ''
	const normalizedTextValue = normalizeQuizText(textValue)
	const normalizedAcceptedAnswers = acceptedAnswers.map(item =>
		normalizeQuizText(item),
	)
	const isTextCorrect =
		(reviewActive || locked) &&
		normalizedTextValue.length > 0 &&
		normalizedAcceptedAnswers.includes(normalizedTextValue)
	const isTextWrong =
		(reviewActive || locked) && normalizedTextValue.length > 0 && !isTextCorrect
	const singleCorrectIndex = correctIndexes[0]
	const singleValue = typeof value === 'number' ? value : null

	return (
		<div className='rounded-[26px] border border-slate-200 bg-slate-50 p-5'>
			<div className='flex flex-wrap items-center justify-between gap-3'>
				<p className='break-words text-base font-black text-slate-900 sm:text-lg'>
					{number}. {question.prompt}
				</p>
				<span className='brand-chip brand-chip--soft'>{question.type}</span>
			</div>

			<div className='mt-4'>
				{question.type === 'single' && (
					<div className='grid gap-3'>
						{question.options?.map((option, index) =>
							(() => {
								const isCorrectOption = correctIndexes.includes(index)
								const isSelectedOption = singleValue === index
								const isWrongSelection =
									(reviewActive || locked) &&
									isSelectedOption &&
									!isCorrectOption
								const isCorrectSelection =
									(reviewActive || locked) &&
									isSelectedOption &&
									isCorrectOption
								const disableOption = locked || isCorrectSelection

								return (
									<button
										key={option}
										type='button'
										disabled={disableOption}
										onClick={() => onChange(index)}
										className={`rounded-[20px] border px-4 py-3 text-left text-sm font-semibold transition-colors ${
											isCorrectSelection
												? 'border-emerald-300 bg-emerald-50 text-emerald-800'
												: isWrongSelection
													? 'border-rose-300 bg-rose-50 text-rose-800'
													: isSelectedOption
														? 'border-sky-600 bg-sky-50 text-sky-700'
														: 'border-slate-200 bg-white text-slate-700'
										} ${disableOption ? 'cursor-default' : ''}`}
									>
										{option}
									</button>
								)
							})(),
						)}
					</div>
				)}

				{question.type === 'multiple' && (
					<div className='grid gap-3'>
						{question.options?.map((option, index) => {
							const checked = multipleValue.includes(index)
							const isCorrect = correctIndexes.includes(index)
							const isCorrectSelection =
								(reviewActive || locked) && checked && isCorrect
							const isWrongSelection =
								(reviewActive || locked) && checked && !isCorrect
							const visualChecked = checked
							const isDisabled = locked || isCorrectSelection

							return (
								<label
									key={option}
									className={`flex items-center gap-3 rounded-[20px] border px-4 py-3 ${
										isCorrectSelection
											? 'border-emerald-300 bg-emerald-50'
											: isWrongSelection
												? 'border-rose-300 bg-rose-50'
												: checked
													? 'border-sky-600 bg-sky-50'
													: 'border-slate-200 bg-white'
									} ${isDisabled ? 'cursor-default' : 'cursor-pointer'}`}
								>
									<input
										type='checkbox'
										checked={visualChecked}
										disabled={isDisabled}
										onChange={e => {
											const next = e.target.checked
												? [...multipleValue, index]
												: multipleValue.filter((item: number) => item !== index)
											onChange(next)
										}}
									/>
									<span
										className={`text-sm font-semibold ${
											isCorrectSelection
												? 'text-emerald-800'
												: isWrongSelection
													? 'text-rose-800'
													: checked
														? 'text-sky-700'
														: 'text-slate-800'
										}`}
									>
										{option}
									</span>
								</label>
							)
						})}
					</div>
				)}

				{question.type === 'order' && (
					<OrderQuestion
						question={question}
						value={toStringArray(value)}
						onChange={onChange}
						locked={locked}
						reviewActive={reviewActive}
					/>
				)}

				{question.type === 'match' && (
					<MatchQuestion
						question={question}
						value={toStringRecord(value)}
						onChange={onChange}
						locked={locked}
						reviewActive={reviewActive}
					/>
				)}

				{question.type === 'text' && (
					<div className='space-y-2'>
						<input
							className={`w-full rounded-[20px] border px-4 py-3 ${
								isTextCorrect
									? 'border-emerald-300 bg-emerald-50 text-emerald-900'
									: isTextWrong
										? 'border-rose-300 bg-rose-50 text-rose-900'
										: 'border-slate-200 bg-white'
							}`}
							readOnly={locked || isTextCorrect}
							value={textValue}
							onChange={e => onChange(e.target.value)}
						/>
					</div>
				)}
			</div>
		</div>
	)
}

export function LessonPlayer({
	lessonId,
	initialData = null,
}: {
	lessonId: number
	initialData?: LessonPlayerPayload | null
}) {
	const rootRef = useRef<HTMLDivElement | null>(null)
	const router = useRouter()
	const normalizedInitialData = initialData
		? normalizeLessonPayload(initialData)
		: null
	const [currentUserRole, setCurrentUserRole] = useState<ViewerRole | null>(
		normalizedInitialData?.viewerRole ?? null,
	)
	const [lesson, setLesson] = useState<LessonDetail | null>(
		normalizedInitialData?.lesson ?? null,
	)
	const [error, setError] = useState('')
	const [lessonMissing, setLessonMissing] = useState(false)
	const [answer, setAnswer] = useState('')
	const [quizAnswers, setQuizAnswers] = useState<Record<string, unknown>>({})
	const [loadingTask, setLoadingTask] = useState(false)
	const [loadingQuiz, setLoadingQuiz] = useState(false)
	const [shownHints, setShownHints] = useState(0)
	const [theoryMarked, setTheoryMarked] = useState(
		Boolean(normalizedInitialData?.isFinished),
	)
	const [interactiveMarked, setInteractiveMarked] = useState(
		Boolean(normalizedInitialData?.isFinished),
	)
	const [taskPassed, setTaskPassed] = useState(
		Boolean(normalizedInitialData?.isFinished),
	)
	const [quizPassed, setQuizPassed] = useState(
		Boolean(normalizedInitialData?.isFinished),
	)
	const [savingCompletion, setSavingCompletion] = useState(false)
	const [progress, setProgress] = useState<ProgressItem | null>(
		normalizedInitialData?.progress ?? null,
	)
	const [judgeReport, setJudgeReport] = useState<JudgeReport | null>(null)
	const [quizReviewActive, setQuizReviewActive] = useState(
		Boolean(
			normalizedInitialData?.isFinished &&
			hasQuizReviewData(normalizedInitialData.lesson.quizzes?.[0] || null),
		),
	)
	const isTeacherLesson = Boolean(lesson?.is_custom)
	const bypassCompletionApi =
		currentUserRole !== null && currentUserRole !== 'student'
	const deferredAnswer = useDeferredValue(answer)

	useEffect(() => {
		if (initialData) return
		setError('')
		setLessonMissing(false)
		api<LessonPlayerPayload>(`/lessons/${lessonId}`, undefined, 'required')
			.then(data => {
				const normalized = normalizeLessonPayload(data)
				setCurrentUserRole(normalized.viewerRole)
				setLesson(normalized.lesson)
				setProgress(normalized.progress)
				setAnswer('')
				setQuizAnswers({})
				setShownHints(0)
				setTheoryMarked(normalized.isFinished)
				setInteractiveMarked(normalized.isFinished)
				setTaskPassed(normalized.isFinished)
				setQuizPassed(normalized.isFinished)
				setJudgeReport(null)
				setQuizReviewActive(
					Boolean(
						normalized.isFinished &&
						hasQuizReviewData(normalized.lesson.quizzes?.[0] || null),
					),
				)
			})
			.catch(e => {
				if (e instanceof ApiError && e.status === 404) {
					setLessonMissing(true)
					return
				}
				setError(getApiErrorMessage(e, 'Не удалось загрузить урок.'))
			})
	}, [initialData, lessonId])

	const quiz = useMemo<QuizItem | null>(
		() => lesson?.quizzes?.[0] || null,
		[lesson],
	)
	const quizHasReviewData = hasQuizReviewData(quiz)
	const quizInReviewMode = quizReviewActive && quizHasReviewData
	const quizLocked = quizPassed && quizHasReviewData
	const task = lesson?.tasks?.[0]
	const taskValidation = task?.validation
	const taskEvaluationMode = taskValidation?.evaluation_mode || 'manual'
	const taskNeedsTeacherReview = Boolean(
		isTeacherLesson && taskEvaluationMode === 'manual',
	)
	const lessonNeedsTeacherReview = Boolean(
		isTeacherLesson && (!task || taskNeedsTeacherReview),
	)
	const teacherReviewFlow = lessonNeedsTeacherReview && !bypassCompletionApi
	const supportsCodePractice = ageGroupSupportsCodePractice(
		lesson?.module.age_group,
	)
	const usesCodeEditor = Boolean(
		supportsCodePractice &&
		(task?.task_type === 'code' || taskValidation?.runner === 'stdin_stdout'),
	)
	const editorLanguage =
		taskValidation?.language === 'javascript'
			? 'javascript'
			: lesson?.module.age_group === 'senior'
				? 'javascript'
				: 'python'
	const completedHints = task ? Math.min(shownHints, task.hints.length) : 0
	const answeredQuizCount = useMemo(() => {
		if (!quiz) return 0
		if (quizLocked) return quiz.questions.length
		return quiz.questions.filter(question =>
			isQuestionAnswered(question, quizAnswers[question.id]),
		).length
	}, [quiz, quizAnswers, quizLocked])
	const theoryHighlights = useMemo(() => {
		if (!lesson) return []

		const items = lesson.theory_blocks.flatMap(block => {
			const entries: string[] = []
			if (block.title?.trim()) {
				entries.push(block.title.trim())
			}
			if (block.items?.length) {
				entries.push(...block.items.map(item => item.trim()).filter(Boolean))
			}
			return entries
		})

		return Array.from(new Set(items)).slice(0, 4)
	}, [lesson])
	const interactiveHighlights = useMemo(() => {
		if (!lesson) return []

		return lesson.interactive_steps
			.map(step => step.title?.trim() || step.text?.trim() || '')
			.filter(Boolean)
			.slice(0, 3)
	}, [lesson])
	const moduleLessons = useMemo(() => {
		if (!lesson) return []

		return [
			...(Array.isArray(lesson.module.lessons) ? lesson.module.lessons : []),
		].sort((left, right) => {
			if (left.order_index !== right.order_index)
				return left.order_index - right.order_index
			return left.id - right.id
		})
	}, [lesson])
	const currentLessonIndex = moduleLessons.findIndex(
		item => item.id === lesson?.id,
	)
	const nextLesson =
		currentLessonIndex >= 0
			? moduleLessons[currentLessonIndex + 1] || null
			: null

	const learningSteps = useMemo(() => {
		return [
			{ id: 'theory', label: 'Теория', completed: theoryMarked },
			{
				id: 'interactive',
				label: 'Разбор примера',
				completed:
					interactiveMarked || (lesson?.interactive_steps.length || 0) === 0,
			},
			{
				id: 'practice',
				label: 'Практика',
				completed: task ? taskPassed : true,
			},
			{
				id: 'quiz',
				label: 'Итоговый квиз',
				completed: quiz ? quizPassed : true,
			},
		]
	}, [
		interactiveMarked,
		lesson?.interactive_steps.length,
		quiz,
		quizPassed,
		task,
		taskPassed,
		theoryMarked,
	])

	const completedStepsCount = learningSteps.filter(
		step => step.completed,
	).length
	const progressPercent = Math.round(
		(completedStepsCount / learningSteps.length) * 100,
	)
	const progressStatusLabel = lessonStatusLabel(progress?.status)
	const lessonPassingScore = lesson?.passing_score ?? 100
	const moduleIsCustom = Boolean(lesson?.module?.is_custom_classroom_module)
	const completionReady = progressPercent >= 100
	const currentLessonPassesThreshold =
		progress?.status === 'completed' || progressPercent >= lessonPassingScore
	const nextLessonRequiresUnlock = !moduleIsCustom
	const canOpenNextLesson =
		Boolean(nextLesson) &&
		!teacherReviewFlow &&
		(!nextLessonRequiresUnlock || currentLessonPassesThreshold)
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
				? 'Можно вернуться к урокам или сразу открыть следующий урок модуля.'
				: 'Можно вернуться к урокам и выбрать следующий шаг.'
			: nextLesson
				? 'Сохраним результат урока и дадим выбор: вернуться к урокам или сразу перейти к следующему уроку модуля.'
				: 'Сохраним результат урока и поможем вернуться к урокам, чтобы выбрать следующий шаг.'
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
			? 'Можно вернуться к урокам и выбрать другой модуль'
			: !canOpenNextLesson
				? `Сначала набери минимум ${lessonPassingScore}% прогресса в текущем уроке`
				: nextLesson.title

	useUserPageMotion(rootRef, [lesson?.id ?? lessonId, progressPercent])

	function handleQuizAnswerChange(questionId: string, next: unknown) {
		if (quizInReviewMode && !quizLocked) {
			setQuizReviewActive(false)
		}

		setQuizAnswers(prev => ({ ...prev, [questionId]: next }))
	}

	function jumpTo(id: string) {
		if (typeof document === 'undefined') return
		const element = document.getElementById(id)
		if (!element) return
		const header = document.querySelector('.progyx-header')
		const nav = document.querySelector('.brand-lesson-nav')
		const headerHeight =
			header instanceof HTMLElement ? header.getBoundingClientRect().height : 0
		const headerPosition =
			header instanceof HTMLElement ? window.getComputedStyle(header).position : ''
		const headerOffset =
			headerPosition === 'sticky' || headerPosition === 'fixed'
				? headerHeight
				: 0
		const navHeight =
			nav instanceof HTMLElement ? nav.getBoundingClientRect().height : 0
		const navPosition =
			nav instanceof HTMLElement ? window.getComputedStyle(nav).position : ''
		const navOffset =
			navPosition === 'sticky' || navPosition === 'fixed' ? navHeight : 0
		const pageOffset = 20
		const top =
			window.scrollY +
			element.getBoundingClientRect().top -
			headerOffset -
			navOffset -
			pageOffset

		window.scrollTo({
			top: Math.max(top, 0),
			behavior: 'smooth',
		})
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
				xp_skipped?: boolean
				progress: ProgressItem
				judge_report?: JudgeReport | null
				requires_teacher_review?: boolean
			}>(
				`/tasks/${task.id}/submit`,
				{
					method: 'POST',
					body: JSON.stringify({ answer }),
				},
				'required',
			)
			const requiresTeacherReview = Boolean(data.requires_teacher_review)
			setJudgeReport(data.judge_report || null)
			const xpNote = data.xp_awarded ? `+${data.xp_awarded} XP.` : data.xp_skipped ? 'XP не начислено (задание для младшей группы).' : ''
			const resultMessage = requiresTeacherReview
				? data.feedback
				: `${data.feedback} Результат: ${data.score}%. ${xpNote}`
			if (data.passed) {
				showSuccessToast(resultMessage)
			} else {
				showInfoToast(resultMessage)
			}
			setTaskPassed(data.passed)
			setProgress(data.progress)
		} catch (e) {
			setJudgeReport(null)
			showErrorToast(
				e instanceof Error ? e.message : 'Не удалось отправить решение.',
			)
		} finally {
			setLoadingTask(false)
		}
	}

	async function submitQuiz() {
		if (!quiz) return
		setLoadingQuiz(true)
		try {
			const data = await api<{
				passed: boolean
				score: number
				correct_answers: number
				total_questions: number
				xp_awarded: number
				xp_skipped?: boolean
				progress: ProgressItem
				review_questions?: QuizQuestion[]
			}>(
				`/quizzes/${quiz.id}/submit`,
				{
					method: 'POST',
					body: JSON.stringify({ answers: quizAnswers }),
				},
				'required',
			)
			const quizXpNote = data.xp_awarded ? `+${data.xp_awarded} XP.` : data.xp_skipped ? 'XP не начислено (задание для младшей группы).' : ''
			const quizResultMessage = `Тест: ${data.correct_answers}/${data.total_questions}, ${data.score}%. ${data.passed ? 'Квиз пройден!' : 'Можно улучшить результат.'} ${quizXpNote}`
			if (data.passed) {
				showSuccessToast(quizResultMessage)
				if (
					Array.isArray(data.review_questions) &&
					data.review_questions.length
				) {
					setLesson(current => {
						if (!current) return current
						return {
							...current,
							quizzes: current.quizzes.map(item =>
								item.id === quiz.id
									? {
											...item,
											questions: data.review_questions || item.questions,
										}
									: item,
							),
						}
					})
				}
				setQuizReviewActive(
					Array.isArray(data.review_questions) &&
						data.review_questions.length > 0,
				)
			} else {
				showInfoToast(quizResultMessage)
				if (
					Array.isArray(data.review_questions) &&
					data.review_questions.length
				) {
					setLesson(current => {
						if (!current) return current
						return {
							...current,
							quizzes: current.quizzes.map(item =>
								item.id === quiz.id
									? {
											...item,
											questions: data.review_questions || item.questions,
										}
									: item,
							),
						}
					})
				}
				setQuizReviewActive(
					Array.isArray(data.review_questions) &&
						data.review_questions.length > 0,
				)
			}
			setQuizPassed(data.passed)
			setProgress(data.progress)
		} catch (e) {
			showErrorToast(
				e instanceof Error ? e.message : 'Не удалось отправить квиз.',
			)
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
			const data = await api<{
				message: string
				progress: ProgressItem
				redirect_url: string
				first_completed_lesson?: boolean
			}>(
				`/lessons/${lessonId}/complete`,
				{
					method: 'PATCH',
					body: JSON.stringify({ completion_percent: progressPercent, answer }),
				},
				'required',
			)
			setProgress(data.progress)
			if (
				data.progress.status === 'completed' ||
				data.progress.status === 'pending_review'
			) {
				showSuccessToast(data.message)
			} else {
				showInfoToast(data.message)
			}
			if (data.first_completed_lesson) {
				queueMascotScenario('first_lesson_complete')
			}
			router.push(redirectTo || data.redirect_url || '/profile')
		} catch (e) {
			showErrorToast(
				e instanceof Error ? e.message : 'Не удалось завершить урок.',
			)
		} finally {
			setSavingCompletion(false)
		}
	}

	if (lessonMissing) {
		return <LessonNotFoundPanel />
	}
	if (error) {
		return (
			<div className='codequest-card mx-auto max-w-xl p-6 sm:p-8'>
				<p className='text-sm font-bold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-400'>
					Не удалось загрузить
				</p>
				<p className='mt-3 text-base leading-relaxed text-slate-800 dark:text-slate-200'>
					{error}
				</p>
			</div>
		)
	}
	if (!lesson) return <div className='codequest-card p-6'>Загружаем урок…</div>

	return (
		<>
			<div
				ref={rootRef}
				className='grid w-full min-w-0 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]'
			>
				<aside className='min-w-0 space-y-5 xl:sticky xl:top-24 xl:self-start'>
					<section
						className='brand-lesson-hero codequest-card p-5 sm:p-6'
						data-motion-hero-copy
					>
						<p className='text-xs font-bold uppercase tracking-[0.2em] text-sky-100'>
							Урок
						</p>
						<h1 className='mt-3 break-words text-2xl font-black text-white sm:text-3xl'>
							{lesson.title}
						</h1>
						<p className='mt-3 break-words text-sm leading-7 text-sky-50/90'>
							{lesson.summary}
						</p>
						<div className='mt-4 flex flex-wrap gap-2'>
							<span className='brand-chip brand-chip--dark'>
								{lesson.module.title}
							</span>
							<span className='brand-chip brand-chip--dark'>
								{lesson.duration_minutes} мин
							</span>
							<span className='brand-chip brand-chip--dark'>
								Порог {lesson.passing_score}%
							</span>
						</div>
					</section>

					<section
						className='brand-lesson-sidebar codequest-card p-5'
						data-motion-hero-visual
					>
						<div className='flex items-center justify-between gap-3'>
							<p className='text-xs font-bold uppercase tracking-[0.2em] text-slate-500'>
								Прогресс
							</p>
							<span className='text-sm font-semibold text-slate-700'>
								{progressPercent}%
							</span>
						</div>
						<div className='mt-3 h-2 overflow-hidden rounded-full bg-slate-100'>
							<div
								className='h-full rounded-full bg-sky-600 transition-all'
								style={{ width: `${progressPercent}%` }}
							/>
						</div>
						<div className='mt-4 space-y-2'>
							{learningSteps.map(step => (
								<button
									key={step.id}
									type='button'
									onClick={() => jumpTo(step.id)}
									className={`flex w-full items-center justify-between rounded-[20px] px-3 py-3 text-left text-sm font-semibold ${
										step.completed
											? 'bg-emerald-50 text-emerald-700'
											: 'bg-slate-50 text-slate-700'
									}`}
								>
									<span>{step.label}</span>
									<span>{step.completed ? 'Готово' : 'В работе'}</span>
								</button>
							))}
						</div>
						<div className='mt-4 rounded-[20px] bg-slate-50 px-3 py-3 text-sm text-slate-600'>
							Статус урока:{' '}
							<span className='font-semibold text-slate-900'>
								{progressStatusLabel}
							</span>
						</div>
					</section>
				</aside>

				<section className='min-w-0 space-y-6'>
					<div className='brand-lesson-nav scrollbar-hidden flex gap-2 overflow-x-auto p-3'>
						{[
							['theory', 'Теория'],
							['interactive', 'Разбор'],
							['practice', 'Практика'],
							['quiz', 'Квиз'],
						].map(([id, label]) => (
							<button
								key={id}
								type='button'
								onClick={() => jumpTo(id)}
								className='shrink-0 rounded-2xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-900 hover:text-white sm:text-sm'
							>
								{label}
							</button>
						))}
					</div>

					<article
						id='theory'
						className='brand-section-panel lesson-player__section-anchor codequest-card min-w-0 overflow-hidden p-6'
						data-motion-reveal
					>
						<div className='flex flex-wrap items-center justify-between gap-3'>
							<div>
								<p className='brand-eyebrow'>Теория</p>
								<h2 className='mt-3 break-words text-2xl font-black text-slate-900 sm:text-3xl'>
									{lesson.title}
								</h2>
							</div>
							<button
								type='button'
								onClick={() => setTheoryMarked(value => !value)}
								aria-pressed={theoryMarked}
								className={`lesson-mark-button ${theoryMarked ? 'lesson-mark-button--active' : ''}`}
							>
								{theoryMarked ? 'Теория изучена' : 'Отметить как изучено'}
							</button>
						</div>
						<div className='mt-6 space-y-4'>
							{lesson.theory_blocks.map((block, index) => (
								<div key={index} className='rounded-[24px] bg-slate-50 p-5'>
									<h3 className='text-lg font-bold text-slate-900'>
										{block.title}
									</h3>
									{block.text && (
										<p className='mt-2 text-sm leading-7 text-slate-600'>
											{block.text}
										</p>
									)}
									{block.items && (
										<ul className='mt-3 space-y-2 text-sm text-slate-600'>
											{block.items.map(item => (
												<li key={item}>• {item}</li>
											))}
										</ul>
									)}
								</div>
							))}
						</div>
					</article>

					<article
						id='interactive'
						className='brand-section-panel lesson-player__section-anchor codequest-card min-w-0 overflow-hidden p-6'
						data-motion-reveal
					>
						<div className='flex flex-wrap items-center justify-between gap-3'>
							<p className='brand-eyebrow'>Разбор примера</p>
							<button
								type='button'
								onClick={() => setInteractiveMarked(value => !value)}
								aria-pressed={interactiveMarked}
								className={`lesson-mark-button ${interactiveMarked ? 'lesson-mark-button--active' : ''}`}
							>
								{interactiveMarked ? 'Разбор отмечен' : 'Отметить как изучено'}
							</button>
						</div>
						<div className='mt-4 grid gap-3'>
							{lesson.interactive_steps.length > 0 ? (
								lesson.interactive_steps.map((step, index) => (
									<div
										key={step.title}
										className='rounded-[24px] border border-slate-200 bg-white p-4'
									>
										<p className='text-xs font-bold uppercase tracking-[0.18em] text-slate-400'>
											Шаг {index + 1}
										</p>
										<h3 className='mt-1 font-bold text-slate-900'>
											{step.title}
										</h3>
										<p className='mt-2 text-sm leading-7 text-slate-600'>
											{step.text}
										</p>
									</div>
								))
							) : (
								<p className='text-sm text-slate-500'>
									Для этого урока нет отдельного интерактивного разбора.
								</p>
							)}
						</div>
					</article>

					{task ? (
						<article
							id='practice'
							className='brand-tech-panel lesson-player__section-anchor codequest-card min-w-0 p-6'
							data-motion-reveal
						>
							<div className='grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_18.75rem]'>
								<div className='min-w-0'>
									<div className='flex min-w-0 flex-wrap items-center justify-between gap-3'>
										<div className='min-w-0'>
											<p className='brand-eyebrow'>Практика</p>
											<h2 className='mt-3 break-words text-xl font-black text-slate-900 sm:text-2xl'>
												{task.title}
											</h2>
										</div>
										<div className='flex min-w-0 flex-wrap items-center gap-2'>
											{task.validation.runner === 'stdin_stdout' && (
												<>
													<span className='rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700'>
														{task.validation.language === 'javascript'
															? 'JavaScript'
															: 'Python'}
													</span>
													<span className='rounded-full bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700'>
														Автотесты {task.validation.tests_count || 0}
													</span>
												</>
											)}
											{!taskNeedsTeacherReview &&
												!isTeacherLesson &&
												task.xp_reward > 0 && (
													<span className='rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700'>
														Награда {task.xp_reward} XP
													</span>
												)}
										</div>
									</div>
									<p className='mt-3 text-sm leading-7 text-slate-600'>
										{task.prompt}
									</p>
									{usesCodeEditor ? (
										<div className='mt-5'>
											<LazyLessonCodeEditor
												language={editorLanguage}
												value={answer}
												onChange={setAnswer}
											/>
										</div>
									) : (
										<div className='lesson-text-answer-shell mt-5 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50'>
											<textarea
												value={answer}
												onChange={e => setAnswer(e.target.value)}
												placeholder='Напиши ответ в свободной форме.'
												className='lesson-text-answer-input block h-[300px] w-full resize-y border-0 bg-transparent p-5 text-sm leading-6 text-slate-800 outline-none focus:ring-0 sm:h-[340px]'
											/>
										</div>
									)}
									<div className='mt-4 flex flex-wrap gap-3'>
										<button
											disabled={loadingTask}
											onClick={submitTask}
											className='w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto'
										>
											{loadingTask
												? 'Проверяем…'
												: taskNeedsTeacherReview
													? 'Сохранить ответ'
													: 'Проверить задачу'}
										</button>
										<button
											type='button'
											onClick={() => setAnswer('')}
											className='w-full rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 sm:w-auto'
										>
											{usesCodeEditor ? 'Очистить код' : 'Очистить ответ'}
										</button>
										<button
											type='button'
											disabled={completedHints >= task.hints.length}
											onClick={() => setShownHints(value => value + 1)}
											className='w-full rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-700 disabled:opacity-50 sm:w-auto'
										>
											{completedHints >= task.hints.length
												? 'Подсказки закончились'
												: 'Показать подсказку'}
										</button>
									</div>
									{judgeReport && (
										<div className='mt-5 max-w-full overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50 p-4'>
											<div className='flex flex-wrap items-start justify-between gap-3'>
												<div className='min-w-0 flex-1'>
													<p className='text-xs font-bold uppercase tracking-[0.18em] text-slate-500'>
														Автопроверка
													</p>
													<p className='mt-1 break-words text-base font-black leading-tight text-slate-900 sm:text-lg'>
														{judgeReport.feedback}
													</p>
												</div>
												<div className='flex w-full flex-wrap gap-2 text-sm font-semibold sm:w-auto sm:justify-end'>
													<span className='rounded-full bg-white px-3 py-1 text-slate-700'>
														{judgeReport.score}%
													</span>
													{typeof judgeReport.tests_total === 'number' && (
														<span className='rounded-full bg-white px-3 py-1 text-slate-700'>
															{judgeReport.tests_passed || 0}/
															{judgeReport.tests_total} тестов
														</span>
													)}
												</div>
											</div>
											{judgeReport.mode === 'keywords' && (
												<div className='mt-3 space-y-2 text-sm text-slate-600'>
													<p>
														Совпало ориентиров: {judgeReport.tests_passed || 0}{' '}
														из {judgeReport.tests_total || 0}.
													</p>
													{(judgeReport.missing_keywords || []).length > 0 && (
														<p>
															Не найдены:{' '}
															{(judgeReport.missing_keywords || []).join(', ')}.
														</p>
													)}
												</div>
											)}
											{judgeReport.mode === 'stdin_stdout' && (
												<div className='mt-4 space-y-3'>
													{(judgeReport.results || []).map(item => (
														<div
															key={`${item.label}-${item.input}`}
															className='overflow-hidden rounded-[22px] bg-white p-4'
														>
															<div className='flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between'>
																<p className='min-w-0 break-words font-semibold text-slate-900'>
																	{item.label}
																</p>
																<span
																	className={`rounded-full px-3 py-1 text-xs font-bold ${item.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
																>
																	{item.passed ? 'OK' : 'Ошибка'}
																</span>
															</div>
															<div className='mt-3 grid min-w-0 gap-3 text-xs leading-6 text-slate-600 md:grid-cols-2'>
																<div className='min-w-0'>
																	<p className='font-bold uppercase tracking-[0.14em] text-slate-400'>
																		Вход
																	</p>
																	<pre className='mt-1 block w-full max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-3 text-emerald-200'>
																		{item.input || '(пусто)'}
																	</pre>
																</div>
																<div className='min-w-0'>
																	<p className='font-bold uppercase tracking-[0.14em] text-slate-400'>
																		Ожидалось
																	</p>
																	<pre className='mt-1 block w-full max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-3 text-emerald-200'>
																		{item.expected || '(пусто)'}
																	</pre>
																</div>
															</div>
															{!item.passed && (
																<div className='mt-3 grid min-w-0 gap-3 text-xs leading-6 text-slate-600 md:grid-cols-2'>
																	<div className='min-w-0'>
																		<p className='font-bold uppercase tracking-[0.14em] text-slate-400'>
																			Получено
																		</p>
																		<pre className='mt-1 block w-full max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-3 text-amber-200'>
																			{item.actual || '(пусто)'}
																		</pre>
																	</div>
																	<div className='min-w-0'>
																		<p className='font-bold uppercase tracking-[0.14em] text-slate-400'>
																			Ошибка
																		</p>
																		<pre className='mt-1 block w-full max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-3 text-rose-200'>
																			{item.stderr ||
																				'Нет системной ошибки, просто другой вывод.'}
																		</pre>
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

								<aside className='brand-hints-panel min-w-0 p-4' data-motion-hover>
									<p className='text-xs font-bold uppercase tracking-[0.18em] text-slate-500'>
										Подсказки
									</p>
									<div className='mt-3 space-y-2'>
										{task.hints.slice(0, completedHints).map((hint, index) => (
											<div
												key={`${hint}-${index}`}
												className={`lesson-hint-card rounded-[20px] bg-white p-3 text-sm text-slate-700 ${
													index === completedHints - 1
														? 'lesson-hint-card--new'
														: ''
												}`}
											>
												{hint}
											</div>
										))}
										{completedHints === 0 && (
											<p className='text-sm text-slate-500'>
												Подсказки появятся здесь по запросу.
											</p>
										)}
									</div>
								</aside>
							</div>
						</article>
					) : (
						<article
							id='practice'
							className='brand-tech-panel lesson-player__section-anchor codequest-card p-6'
							data-motion-reveal
						>
							<p className='text-sm text-slate-500'>
								В этом уроке нет отдельной практической задачи.
							</p>
						</article>
					)}

					{quiz ? (
						<article
							id='quiz'
							className='brand-section-panel lesson-player__section-anchor codequest-card p-6'
							data-motion-reveal
						>
							<div className='flex flex-wrap items-center justify-between gap-3'>
								<div>
									<p className='brand-eyebrow'>Итоговый квиз</p>
									<h2 className='mt-3 break-words text-xl font-black text-slate-900 sm:text-2xl'>
										{quiz.title}
									</h2>
								</div>
								<div className='flex flex-wrap gap-2'>
									<span className='rounded-full bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700'>
										Порог {quiz.passing_score}%
									</span>
									<span className='rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700'>
										Ответов: {answeredQuizCount}/{quiz.questions.length}
									</span>
								</div>
							</div>
							<div className='mt-5 space-y-4'>
								{quiz.questions.map((question, index) => (
									<QuestionCard
										key={question.id}
										question={question}
										value={quizAnswers[question.id]}
										onChange={next => handleQuizAnswerChange(question.id, next)}
										number={index + 1}
										locked={quizLocked}
										reviewActive={quizInReviewMode}
									/>
								))}
							</div>
							<button
								disabled={loadingQuiz || quizLocked}
								onClick={submitQuiz}
								className='mt-5 w-full rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto'
							>
								{quizLocked
									? 'Результат зафиксирован'
									: loadingQuiz
										? 'Проверяем…'
										: quizInReviewMode
											? 'Проверить ещё раз'
											: 'Проверить квиз'}
							</button>
						</article>
					) : (
						<article
							id='quiz'
							className='brand-section-panel lesson-player__section-anchor codequest-card p-6'
							data-motion-reveal
						>
							<p className='text-sm text-slate-500'>
								Для этого урока квиз не добавлен.
							</p>
						</article>
					)}

					<section className='lesson-completion-card' data-motion-reveal>
						<div className='lesson-completion-shell'>
							<div className='lesson-completion-badge' aria-hidden='true'>
								<span className='lesson-completion-badge-icon'>
									{completionBadgeLabel}
								</span>
							</div>
							<div className='lesson-completion-copy'>
								<p className='lesson-completion-eyebrow'>Завершение урока</p>
								<h2 className='lesson-completion-title'>{completionTitle}</h2>
								<p className='lesson-completion-description'>
									{completionDescription}
								</p>
								<div className='lesson-completion-meta'>
									<span className='lesson-completion-chip lesson-completion-chip-progress'>
										Прогресс {progressPercent}%
									</span>
									<span className='lesson-completion-chip lesson-completion-chip-status'>
										Статус: {progressStatusLabel}
									</span>
									<span className='lesson-completion-chip lesson-completion-chip-next'>
										{nextLesson
											? `Дальше: ${nextLesson.title}`
											: 'Это последний урок модуля'}
									</span>
								</div>
							</div>
							<div className='lesson-completion-actions'>
								<button
									type='button'
									disabled={savingCompletion}
									onClick={() => finishLesson('/roadmap')}
									className='lesson-completion-button lesson-completion-button-roadmap'
								>
									<span className='lesson-completion-button-title'>
										{savingCompletion ? 'Сохраняем...' : 'Перейти к урокам'}
									</span>
									<span className='lesson-completion-button-hint'>
										К карте модулей и следующему выбору
									</span>
								</button>
								<button
									type='button'
									disabled={savingCompletion || !canOpenNextLesson}
									onClick={() =>
										nextLesson && finishLesson(`/lessons/${nextLesson.id}`)
									}
									className='lesson-completion-button lesson-completion-button-next'
								>
									<span className='lesson-completion-button-title'>
										{nextActionTitle}
									</span>
									<span className='lesson-completion-button-hint'>
										{nextActionHint}
									</span>
								</button>
							</div>
						</div>
					</section>
				</section>
			</div>

			<LazyLessonGigachatDrawer
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
				draftAnswer={deferredAnswer}
			/>
		</>
	)
}
