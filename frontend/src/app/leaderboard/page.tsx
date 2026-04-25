'use client'

import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { api } from '@/lib/api'
import { useEffect, useRef, useState } from 'react'

type LeaderboardScope = 'global' | 'class'

interface Row {
	id?: number
	position: number
	username?: string | null
	full_name?: string | null
	xp: number
	level: number
	age_group: string | null
	name?: string | null
}

interface ClassroomItem {
	id: number
	name: string
	description?: string | null
	code?: string
	teacher_id?: number
	students_count?: number
	assignments_count?: number
}

interface LeaderboardResponse {
	leaderboard: Row[]
	classes?: ClassroomItem[]
	scope?: LeaderboardScope
	classroom?: ClassroomItem | null
	refresh_seconds?: number
}

interface StoredLeaderboardView {
	scope: LeaderboardScope
	classroomId: number | null
}

const LEADERBOARD_VIEW_STORAGE_KEY = 'progyx:leaderboard-view:v1'
const GLOBAL_LEADERBOARD_REFRESH_MS = 5 * 60 * 1000
/** Matches backend `LEADERBOARD_LIMIT` — never show more rows than this. */
const LEADERBOARD_DISPLAY_LIMIT = 50

function firstTokenFromName(value: string | null | undefined) {
	if (typeof value !== 'string') return ''
	const t = value.trim()
	if (!t) return ''
	return t.split(/\s+/)[0] ?? ''
}

function isBrowser() {
	return typeof window !== 'undefined'
}

function readStoredLeaderboardView(): StoredLeaderboardView {
	if (!isBrowser()) {
		return { scope: 'global', classroomId: null }
	}

	try {
		const parsed = JSON.parse(
			window.localStorage.getItem(LEADERBOARD_VIEW_STORAGE_KEY) || '{}'
		) as Partial<StoredLeaderboardView>
		const scope = parsed.scope === 'class' ? 'class' : 'global'
		const classroomId =
			typeof parsed.classroomId === 'number' &&
			Number.isFinite(parsed.classroomId)
				? parsed.classroomId
				: null

		return { scope, classroomId }
	} catch {
		return { scope: 'global', classroomId: null }
	}
}

function writeStoredLeaderboardView(
	scope: LeaderboardScope,
	classroomId: number | null
) {
	if (!isBrowser()) return

	try {
		window.localStorage.setItem(
			LEADERBOARD_VIEW_STORAGE_KEY,
			JSON.stringify({ scope, classroomId })
		)
	} catch {
		// User preferences are best-effort; the rating itself must keep working.
	}
}

function buildLeaderboardPath(
	scope: LeaderboardScope,
	classroomId: number | null
) {
	if (scope !== 'class') {
		return '/leaderboard'
	}

	const params = new URLSearchParams({ scope: 'class' })
	if (classroomId !== null) {
		params.set('classroom_id', String(classroomId))
	}

	return `/leaderboard?${params.toString()}`
}

function formatLeaderboardIdentity(row: Row) {
	const displayName =
		firstTokenFromName(row.full_name) ||
		firstTokenFromName(row.name) ||
		''
	const username =
		typeof row.username === 'string'
			? row.username.trim()
			: ''

	if (displayName && username && displayName !== username) {
		return `${displayName} · ${username}`
	}

	return displayName || username || `Участник #${row.position}`
}

function formatAgeGroup(ageGroup: string | null) {
	return ageGroup || 'не указана'
}

export default function LeaderboardPage() {
	const rootRef = useRef<HTMLElement | null>(null)
	const [rows, setRows] = useState<Row[]>([])
	const [classes, setClasses] = useState<ClassroomItem[]>([])
	const [scope, setScope] = useState<LeaderboardScope>('global')
	const [selectedClassroomId, setSelectedClassroomId] = useState<number | null>(
		null
	)
	const [preferencesReady, setPreferencesReady] = useState(false)
	const [isLoading, setIsLoading] = useState(true)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	useUserPageMotion(rootRef, [rows.length, scope])

	useEffect(() => {
		const storedView = readStoredLeaderboardView()
		setScope(storedView.scope)
		setSelectedClassroomId(storedView.classroomId)
		setPreferencesReady(true)
	}, [])

	useEffect(() => {
		if (!preferencesReady) return

		let cancelled = false
		let intervalId: number | null = null

		const loadLeaderboard = async (showSpinner = true) => {
			if (showSpinner) {
				setIsLoading(true)
			}
			setErrorMessage(null)

			try {
				const data = await api<LeaderboardResponse>(
					buildLeaderboardPath(scope, selectedClassroomId),
					undefined,
					true
				)
				if (cancelled) return

				const responseClasses = data.classes ?? []
				setRows(
					(data.leaderboard ?? []).slice(0, LEADERBOARD_DISPLAY_LIMIT)
				)
				setClasses(responseClasses)

				if (data.scope === 'class') {
					const responseClassroomId =
						data.classroom?.id ?? responseClasses[0]?.id ?? null
					setSelectedClassroomId(responseClassroomId)
					writeStoredLeaderboardView('class', responseClassroomId)
				} else {
					writeStoredLeaderboardView('global', selectedClassroomId)
				}
			} catch {
				if (cancelled) return

				if (scope === 'class') {
					setScope('global')
					writeStoredLeaderboardView('global', null)
				} else {
					setRows([])
					setErrorMessage('Не удалось загрузить рейтинг.')
				}
			} finally {
				if (!cancelled && showSpinner) {
					setIsLoading(false)
				}
			}
		}

		void loadLeaderboard()

		if (scope === 'global') {
			intervalId = window.setInterval(() => {
				void loadLeaderboard(false)
			}, GLOBAL_LEADERBOARD_REFRESH_MS)
		}

		return () => {
			cancelled = true
			if (intervalId !== null) {
				window.clearInterval(intervalId)
			}
		}
	}, [preferencesReady, scope, selectedClassroomId])

	const activeClassroom =
		classes.find(classroom => classroom.id === selectedClassroomId) ??
		classes[0] ??
		null
	const podium = rows.slice(0, 3)
	const rest = rows.slice(3)

	const handleScopeChange = (nextScope: LeaderboardScope) => {
		const nextClassroomId =
			nextScope === 'class'
				? selectedClassroomId ?? classes[0]?.id ?? null
				: selectedClassroomId

		setScope(nextScope)
		if (nextScope === 'class') {
			setSelectedClassroomId(nextClassroomId)
		}
		writeStoredLeaderboardView(nextScope, nextClassroomId)
	}

	const handleClassroomChange = (value: string) => {
		const nextClassroomId = Number(value)
		if (!Number.isFinite(nextClassroomId)) return

		setSelectedClassroomId(nextClassroomId)
		setScope('class')
		writeStoredLeaderboardView('class', nextClassroomId)
	}

	return (
		<main ref={rootRef} className='brand-app-shell'>
			<div className='page-shell mx-auto w-full max-w-[96rem]'>
				<section
					className='codequest-card overflow-hidden p-6 sm:px-8 sm:py-8 lg:pl-3'
					data-motion-reveal
				>
					<p className='brand-eyebrow'>Top players</p>
					<h1 className='mt-3 text-4xl font-black leading-tight text-slate-900 sm:text-5xl'>
						Рейтинг учеников
					</h1>

					{classes.length > 0 && (
						<div className='mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
							<div className='inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto'>
								<button
									type='button'
									aria-pressed={scope === 'global'}
									onClick={() => handleScopeChange('global')}
									className={`min-h-10 flex-1 rounded-md px-4 text-sm font-bold transition sm:flex-none ${
										scope === 'global'
											? 'bg-slate-900 text-white shadow-sm'
											: 'text-slate-600 hover:bg-white hover:text-slate-900'
									}`}
								>
									Глобальный
								</button>
								<button
									type='button'
									aria-pressed={scope === 'class'}
									onClick={() => handleScopeChange('class')}
									className={`min-h-10 flex-1 rounded-md px-4 text-sm font-bold transition sm:flex-none ${
										scope === 'class'
											? 'bg-slate-900 text-white shadow-sm'
											: 'text-slate-600 hover:bg-white hover:text-slate-900'
									}`}
								>
									Класс
								</button>
							</div>

							{classes.length > 1 && (
								<select
									aria-label='Класс'
									value={activeClassroom?.id ?? ''}
									onChange={event => handleClassroomChange(event.target.value)}
									disabled={scope !== 'class'}
									className='min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'
								>
									{classes.map(classroom => (
										<option key={classroom.id} value={classroom.id}>
											{classroom.name}
										</option>
									))}
								</select>
							)}
						</div>
					)}

					{scope === 'class' && activeClassroom && (
						<p className='mt-4 text-sm font-semibold text-slate-500'>
							{activeClassroom.name}
						</p>
					)}

					{isLoading && rows.length === 0 ? (
						<p className='mt-8 text-sm font-semibold text-slate-500'>
							Загружаем рейтинг...
						</p>
					) : errorMessage ? (
						<p className='mt-8 text-sm font-semibold text-rose-600'>
							{errorMessage}
						</p>
					) : rows.length === 0 ? (
						<p className='mt-8 text-sm font-semibold text-slate-500'>
							Пока нет участников рейтинга.
						</p>
					) : (
						<>
							{podium.length > 0 && (
								<div className='leaderboard-podium-wrap w-full' data-motion-stagger>
									<div className='leaderboard-podium mt-4'>
										{podium.map((row, index) => (
											<article
												key={row.id ?? `${row.username ?? row.position}-${row.position}`}
												className={`leaderboard-podium__card min-h-0 p-3 sm:p-3.5 lg:p-2.5 ${index === 0 ? 'leaderboard-podium__card--top' : ''} ${index === 1 ? 'leaderboard-podium__card--rung2' : ''} ${index === 2 ? 'leaderboard-podium__card--rung3' : ''}`}
												data-motion-item
												data-motion-hover
											>
												<div className='flex shrink-0 items-center justify-between gap-2'>
													<span
														className={`leaderboard-podium__rank ${
															index === 0
																? 'leaderboard-podium__rank--gold'
																: index === 1
																	? 'leaderboard-podium__rank--silver'
																	: 'leaderboard-podium__rank--bronze'
														}`}
													>
														#{row.position}
													</span>
													<span className='brand-chip brand-chip--warm min-h-8 py-1 text-xs sm:text-[0.7rem]'>
														{row.xp} XP
													</span>
												</div>
												<h2
													className={`mt-2 min-h-0 flex-1 overflow-hidden font-black leading-tight text-slate-900 line-clamp-2 ${
														index === 0
															? 'text-lg sm:text-xl'
															: index === 1
																? 'text-base sm:text-lg'
																: 'text-sm sm:text-base'
													}`}
												>
													{formatLeaderboardIdentity(row)}
												</h2>
												<div className='mt-auto flex shrink-0 flex-wrap gap-1.5 pt-1 text-xs sm:text-sm text-slate-600'>
													<span className='rounded-full bg-slate-50 px-2 py-0.5'>
														Группа: {formatAgeGroup(row.age_group)}
													</span>
													<span className='rounded-full bg-slate-50 px-2 py-0.5'>
														Уровень: {row.level}
													</span>
												</div>
											</article>
										))}
									</div>
									<div className='leaderboard-podium-stairs' aria-hidden>
										<span />
										<span />
										<span />
									</div>
								</div>
							)}

							<div className='mt-8 space-y-3 md:hidden' data-motion-stagger>
								{rest.map(row => (
									<article
										key={row.id ?? `${row.username ?? row.position}-${row.position}`}
										className='rounded-[22px] border border-slate-200 bg-slate-50 p-4'
										data-motion-item
									>
										<div className='flex items-start justify-between gap-3'>
											<div>
												<p className='text-xs font-bold uppercase tracking-[0.16em] text-slate-500'>
													#{row.position}
												</p>
												<h2 className='mt-1 text-lg font-black text-slate-900'>
													{formatLeaderboardIdentity(row)}
												</h2>
											</div>
											<span className='rounded-full bg-white px-3 py-1 text-sm font-semibold text-sky-700'>
												{row.xp} XP
											</span>
										</div>
										<div className='mt-3 flex flex-wrap gap-2 text-sm text-slate-600'>
											<span className='rounded-full bg-white px-3 py-1'>
												Группа: {formatAgeGroup(row.age_group)}
											</span>
											<span className='rounded-full bg-white px-3 py-1'>
												Уровень: {row.level}
											</span>
										</div>
									</article>
								))}
							</div>
							<div
								className='mt-6 hidden overflow-x-auto md:block'
								data-motion-reveal
							>
								<table className='min-w-full text-left'>
									<thead>
										<tr className='border-b border-slate-200 text-sm text-slate-500'>
											<th className='py-3 pl-0 pr-3 sm:px-2 lg:pl-0'>#</th>
											<th className='px-2 py-3 sm:px-3'>Пользователь</th>
											<th className='px-2 py-3 sm:px-3'>Возрастная группа</th>
											<th className='px-2 py-3 sm:px-3'>Уровень</th>
											<th className='px-2 py-3 sm:px-3'>XP</th>
										</tr>
									</thead>
									<tbody>
										{rest.map(row => (
											<tr
												key={row.id ?? `${row.username ?? row.position}-${row.position}`}
												className='border-b border-slate-100 text-sm'
											>
												<td className='py-3 pl-0 pr-3 font-bold text-slate-900 sm:px-2 lg:pl-0'>
													{row.position}
												</td>
												<td className='px-2 py-3 sm:px-3 sm:py-4'>
													{formatLeaderboardIdentity(row)}
												</td>
												<td className='px-2 py-3 sm:px-3 sm:py-4'>
													{formatAgeGroup(row.age_group)}
												</td>
												<td className='px-2 py-3 sm:px-3 sm:py-4'>{row.level}</td>
												<td className='px-2 py-3 font-semibold text-sky-700 sm:px-3 sm:py-4'>
													{row.xp}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					)}
				</section>
			</div>
		</main>
	)
}
