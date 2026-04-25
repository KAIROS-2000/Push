import type { LessonDetail, ProgressItem, QuizItem, QuizQuestion } from '@/types'

type ViewerRole = 'student' | 'teacher' | 'admin' | 'superadmin'

export interface LessonPlayerPayload {
	lesson: LessonDetail
	progress: ProgressItem
	viewer_role: ViewerRole
}

export function moveItem(list: string[], from: number, to: number) {
	const next = [...list]
	const [picked] = next.splice(from, 1)
	next.splice(to, 0, picked)
	return next
}

export function normalizeQuizText(value: unknown) {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.join(' ')
}

export function hasMovementTarget(
	listLength: number,
	from: number,
	step: -1 | 1,
	fixedIndexes: Set<number>,
) {
	let target = from + step

	while (target >= 0 && target < listLength && fixedIndexes.has(target)) {
		target += step
	}

	return target >= 0 && target < listLength
}

export function moveItemAroundFixed(
	list: string[],
	from: number,
	step: -1 | 1,
	fixedIndexes: Set<number>,
) {
	let target = from + step

	while (target >= 0 && target < list.length && fixedIndexes.has(target)) {
		target += step
	}

	if (target < 0 || target >= list.length) {
		return list
	}

	return moveItem(list, from, target)
}

export function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value.filter((item): item is string => typeof item === 'string')
}

export function toNumberArray(value: unknown): number[] {
	if (!Array.isArray(value)) return []
	return value.filter((item): item is number => typeof item === 'number')
}

export function toStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object') return {}
	return Object.entries(value).reduce<Record<string, string>>(
		(acc, [key, item]) => {
			if (typeof item === 'string') {
				acc[key] = item
			}
			return acc
		},
		{},
	)
}

export function isQuestionAnswered(question: QuizQuestion, answer: unknown) {
	if (question.type === 'single') return typeof answer === 'number'
	if (question.type === 'multiple') return toNumberArray(answer).length > 0
	if (question.type === 'order') return toStringArray(answer).length > 0
	if (question.type === 'match')
		return Object.keys(toStringRecord(answer)).length > 0
	if (question.type === 'text')
		return typeof answer === 'string' && answer.trim().length > 0
	return false
}

export function hasQuizReviewData(quiz: QuizItem | null | undefined) {
	return Boolean(
		quiz?.questions.some(question => question.correct !== undefined),
	)
}

export function ageGroupSupportsCodePractice(ageGroup?: string | null) {
	return ageGroup !== 'junior'
}

export function normalizeLessonPayload(data: LessonPlayerPayload) {
	const lesson = {
		...data.lesson,
		module: {
			...data.lesson.module,
			lessons: Array.isArray(data.lesson.module?.lessons)
				? data.lesson.module.lessons
				: [],
		},
	}
	const isFinished =
		data.progress.status === 'completed' ||
		data.progress.status === 'pending_review'
	return {
		lesson,
		progress: data.progress,
		viewerRole: data.viewer_role,
		isFinished,
	}
}

export function lessonStatusLabel(status?: ProgressItem['status']) {
	if (status === 'completed') return 'Завершён'
	if (status === 'pending_review') return 'Ожидает проверки'
	if (status === 'needs_revision') return 'Нужно исправить'
	if (status === 'in_progress') return 'В процессе'
	return 'Не начат'
}
