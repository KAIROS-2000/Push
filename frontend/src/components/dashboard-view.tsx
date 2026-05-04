'use client'

import { AchievementShowcase } from '@/components/achievement-showcase'
import { RolePill } from '@/components/role-pill'
import { StatCard } from '@/components/stat-card'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'
import { UserLocalTime } from '@/components/user-local-time'
import { DashboardData } from '@/types'
import {
	BookOpenCheck,
	ClipboardList,
	Flame,
	Trophy,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

const PARENT_LINK_CODE_STORAGE_KEY = 'proghub_student_parent_link_code_v1'

type StoredParentLinkCode = {
	userId: number
	code: string
	expires_at: string
}

function readStoredParentLinkCode(userId: number): StoredParentLinkCode | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = sessionStorage.getItem(PARENT_LINK_CODE_STORAGE_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw) as StoredParentLinkCode
		if (parsed.userId !== userId || !parsed.code || !parsed.expires_at) return null
		return parsed
	} catch {
		return null
	}
}

function writeStoredParentLinkCode(payload: StoredParentLinkCode) {
	try {
		sessionStorage.setItem(PARENT_LINK_CODE_STORAGE_KEY, JSON.stringify(payload))
	} catch {
		// ignore (private mode, disabled storage)
	}
}

function clearStoredParentLinkCode() {
	try {
		sessionStorage.removeItem(PARENT_LINK_CODE_STORAGE_KEY)
	} catch {
		// ignore (private mode, disabled storage)
	}
}

function linkCodeExpiryMatches(a: string, b: string) {
	return new Date(a).getTime() === new Date(b).getTime()
}

function formatParentLinkCodeForDisplay(code: string) {
	const compact = code.replace(/\s+/g, '').toUpperCase()
	return compact.replace(/(.{4})/g, '$1 ').trim()
}

function lessonStateLabel(state?: string | null) {
	if (state === 'completed') return 'Завершён'
	if (state === 'current') return 'В работе'
	if (state === 'open') return 'Доступен'
	if (state === 'locked') return 'Закрыт'
	return null
}

function submissionStatusLabel(status?: string) {
	if (status === 'pending_review') return 'Ожидает проверки'
	if (status === 'checked') return 'Проверено: верно'
	if (status === 'needs_revision') return 'Нужно исправить'
	if (status === 'submitted') return 'Ответ отправлен'
	return 'Ждёт выполнения'
}

export function DashboardView({
	initialData = null,
}: {
	initialData?: DashboardData | null
}) {
	const rootRef = useRef<HTMLDivElement | null>(null)
	const [data, setData] = useState<DashboardData | null>(initialData)
	const [error, setError] = useState('')
	const [classCode, setClassCode] = useState('')
	const [showcaseOpen, setShowcaseOpen] = useState(false)
	const [revealedParentLinkCode, setRevealedParentLinkCode] = useState<{
		code: string
		expires_at: string
	} | null>(null)

	useUserPageMotion(rootRef, [Boolean(data)])

	async function loadDashboard() {
		const result = await api<DashboardData>('/dashboard', undefined, 'required')
		setData(result)
	}

	useEffect(() => {
		if (initialData) return
		loadDashboard().catch(e =>
			setError(
				e instanceof Error ? e.message : 'Не удалось загрузить dashboard',
			),
		)
	}, [initialData])

	useEffect(() => {
		if (!data || data.user.role !== 'student') return
		const pl = data.parent_link_code
		const exp = pl.expires_at
		if (!pl.active || !exp) {
			clearStoredParentLinkCode()
			setRevealedParentLinkCode(null)
			return
		}
		const stored = readStoredParentLinkCode(data.user.id)
		setRevealedParentLinkCode(prev => {
			if (stored && linkCodeExpiryMatches(stored.expires_at, exp)) {
				return { code: stored.code, expires_at: exp }
			}
			if (stored && !linkCodeExpiryMatches(stored.expires_at, exp)) {
				clearStoredParentLinkCode()
			}
			if (prev && linkCodeExpiryMatches(prev.expires_at, exp)) {
				return prev
			}
			return null
		})
	}, [data])

	async function joinClass() {
		if (!classCode.trim()) {
			showInfoToast('Введите код класса перед отправкой.')
			return
		}
		try {
			const response = await api<{ message?: string }>(
				'/classes/join',
				{ method: 'POST', body: JSON.stringify({ code: classCode.trim() }) },
				'required',
			)
			showSuccessToast(
				response.message ||
					'Заявка отправлена учителю. Класс появится после подтверждения.',
			)
			setClassCode('')
			await loadDashboard()
		} catch (e) {
			showErrorToast(getApiErrorMessage(e, 'Не удалось вступить в класс.'))
		}
	}

	async function createParentLinkCode() {
		if (!data || data.user.role !== 'student') return
		try {
			const res = await api<{
				code: string
				expires_at: string
				message?: string
			}>(
				'/student/parent-link-code',
				{
					method: 'POST',
					body: JSON.stringify({}),
				},
				'required',
			)
			writeStoredParentLinkCode({
				userId: data.user.id,
				code: res.code,
				expires_at: res.expires_at,
			})
			setRevealedParentLinkCode({ code: res.code, expires_at: res.expires_at })
			showSuccessToast(
				res.message || 'Семейный код создан. Передайте его родителю.',
			)
			await loadDashboard()
		} catch (e) {
			showErrorToast(
				getApiErrorMessage(e, 'Не удалось создать код для родителя.'),
			)
		}
	}

	async function copyRevealedParentLinkCode() {
		if (!revealedParentLinkCode) return
		try {
			const plain = revealedParentLinkCode.code.replace(/\s+/g, '').toUpperCase()
			await navigator.clipboard.writeText(plain)
			showSuccessToast('Код скопирован в буфер обмена.')
		} catch {
			showErrorToast('Не удалось скопировать код.')
		}
	}

	if (error) {
		return (
			<div className='codequest-card p-6 text-rose-700'>
				{error}. Проверьте авторизацию и повторите попытку.
			</div>
		)
	}

	if (!data) {
		return <div className='codequest-card p-6'>Загружаем данные dashboard…</div>
	}

	const isStudent = data.user.role === 'student'
	const firstName = data.user.full_name.split(' ')[0]
	const lessonMomentum = Math.min(100, data.summary.completed_lessons * 12)
	const assignmentFocus = data.summary.assignments_open
		? Math.min(100, data.summary.assignments_open * 24)
		: 8
	const achievementsTotal = data.summary.achievements_total
	const achievementGlow =
		typeof achievementsTotal === 'number' && achievementsTotal > 0
			? Math.min(
					100,
					Math.round((data.summary.achievements / achievementsTotal) * 100),
				)
			: achievementsTotal === 0
				? 0
				: Math.min(100, data.summary.achievements * 18)
	const streakProgress = Math.min(100, (data.user.streak / 7) * 100)
	const daysToWeeklyStreak = Math.max(0, 7 - data.user.streak)

	return (
		<div ref={rootRef} className='space-y-6'>
			<section
				className='dashboard-hero codequest-card overflow-hidden p-4 sm:p-5'
				data-motion-reveal
			>
				<div className='grid gap-4 xl:grid-cols-[1.08fr_0.92fr] xl:items-center'>
					<div className='min-w-0' data-motion-hero-copy>
						<RolePill role={data.user.role} />
						<h2 className='mt-3 break-words text-3xl font-black leading-tight text-slate-900 sm:text-4xl'>
							{firstName}, двигаемся дальше по твоему маршруту.
						</h2>
						<p className='mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base'>
							Ты уже на уровне{' '}
							<span className='font-bold text-slate-900'>
								{data.user.level}
							</span>{' '}
							и носишь ранг{' '}
							<span className='font-bold text-slate-900'>
								{data.user.rank_title}
							</span>
							. До следующей ступени осталось{' '}
							<span className='font-bold text-slate-900'>
								{data.user.xp_to_next} XP
							</span>
							.
						</p>

						<div className='mt-4 flex flex-wrap gap-1.5'>
							<span className='brand-chip brand-chip--soft'>
								Серия: {data.user.streak} дней
							</span>
							<span className='brand-chip brand-chip--soft'>
								Достижения: {data.summary.achievements}
							</span>
							<span className='brand-chip brand-chip--warm'>
								Открытые задания: {data.summary.assignments_open}
							</span>
						</div>
					</div>

					<div
						className='dashboard-next w-full p-4 sm:p-5'
						data-motion-hero-visual
					>
						<p className='text-xs font-bold uppercase tracking-[0.18em] text-sky-100'>
							Следующий шаг
						</p>
						{data.continue_lesson ? (
							<>
								<h3 className='mt-2 break-words text-2xl font-black text-white'>
									{data.continue_lesson.title}
								</h3>
								<p className='mt-1.5 text-sm leading-6 text-sky-50/90'>
									{data.continue_lesson.summary}
								</p>
								<div className='mt-3 flex flex-wrap gap-1.5'>
									<span className='brand-chip brand-chip--dark'>
										{data.continue_lesson.module_title}
									</span>
									<span className='brand-chip brand-chip--dark'>
										{data.continue_lesson.duration_minutes} мин
									</span>
								</div>
								<div className='mt-4 flex flex-col gap-2 sm:flex-row'>
									<Link
										href={`/lessons/${data.continue_lesson.id}`}
										className='brand-button-primary w-full sm:w-auto'
									>
										Продолжить урок
									</Link>
									<Link
										href='/roadmap'
										className='brand-button-secondary w-full sm:w-auto'
									>
										Перейти к урокам
									</Link>
								</div>
							</>
						) : (
							<>
								<p className='mt-2 text-sm leading-6 text-sky-50/90'>
									Все доступные уроки сейчас пройдены. Открой карту модулей и
									выбери новый шаг.
								</p>
								<Link
									href='/roadmap'
									className='brand-button-primary mt-4 w-full sm:w-auto'
								>
									Перейти к урокам
								</Link>
							</>
						)}
					</div>
				</div>
			</section>

			<section
				className='student-metrics-grid grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4'
				data-motion-stagger
			>
				<StatCard
					value={String(data.summary.completed_lessons)}
					label='завершённых уроков'
					icon={BookOpenCheck}
					kicker='уроки'
					progress={lessonMomentum}
					tone='sky'
				/>
				<StatCard
					value={String(data.summary.assignments_open)}
					label='активных заданий'
					icon={ClipboardList}
					kicker='фокус'
					progress={assignmentFocus}
					tone='emerald'
				/>
				<div
					role='button'
					tabIndex={0}
					className='achievement-metric-trigger cursor-pointer text-left'
					onClick={() => setShowcaseOpen(true)}
					onKeyDown={event => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault()
							setShowcaseOpen(true)
						}
					}}
				>
					<StatCard
						value={String(data.summary.achievements)}
						label='достижений'
						icon={Trophy}
						kicker='награды'
						progress={achievementGlow}
						tone='violet'
					/>
				</div>
				<StatCard
					value={String(data.user.streak)}
					label='дней подряд'
					icon={Flame}
					kicker='ритм'
					progress={streakProgress}
					tone='amber'
				/>
			</section>

			<section
				className='grid gap-6 lg:grid-cols-[1.05fr_0.95fr]'
				data-motion-stagger
			>
				<article className='codequest-card p-6' data-motion-item>
					<p className='brand-eyebrow'>Сегодня</p>
					<h3 className='mt-3 text-2xl font-black text-slate-900'>
						Ежедневные задачи и короткие победы
					</h3>
					<div className='mt-5 space-y-3'>
						{data.daily_quests.map(quest => (
							<div
								key={quest.id}
								className='flex flex-col items-start gap-3 rounded-[24px] bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between'
							>
								<div>
									<p className='font-bold text-slate-900'>{quest.title}</p>
									<p className='text-sm text-slate-500'>
										Награда: {quest.xp} XP
									</p>
								</div>
								<span
									className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${
										quest.completed
											? 'bg-emerald-100 text-emerald-700'
											: 'bg-amber-100 text-amber-700'
									}`}
								>
									{quest.completed ? 'Готово' : 'В процессе'}
								</span>
							</div>
						))}
					</div>
				</article>

				<article className='codequest-card p-6' data-motion-item>
					<p className='brand-eyebrow'>Достижения</p>
					<h3 className='mt-3 text-2xl font-black text-slate-900'>
						Последние подтверждённые результаты
					</h3>
					<div className='mt-5 grid gap-3'>
						{data.recent_achievements.length > 0 ? (
							data.recent_achievements.map(item => (
								<div
									key={item.id}
									className='rounded-[24px] border border-slate-200 bg-white px-4 py-4'
								>
									<p className='font-bold text-slate-900'>{item.name}</p>
									<p className='mt-1 text-sm text-slate-500'>
										{item.description}
									</p>
									<p className='mt-3 text-sm font-semibold text-sky-700'>
										+{item.xp_reward} XP
									</p>
								</div>
							))
						) : (
							<p className='text-sm text-slate-500'>
								Пока нет достижений, начни с первого урока.
							</p>
						)}
					</div>
				</article>
			</section>

			<section
				className='grid gap-6 xl:grid-cols-[1.1fr_0.9fr]'
				data-motion-stagger
			>
				<article className='codequest-card p-6' data-motion-item>
					<div className='flex flex-wrap items-center justify-between gap-3'>
						<div>
							<p className='brand-eyebrow'>Классы и задания</p>
							<h3 className='mt-3 text-2xl font-black text-slate-900'>
								Учительские группы и домашние задания
							</h3>
						</div>
						<div className='flex flex-wrap gap-2'>
							<span className='brand-chip brand-chip--soft'>
								{data.assignments_preview.length} активных заданий
							</span>
						</div>
					</div>

					{isStudent ? (
						<div className='mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap'>
							<input
								className='w-full min-w-0 flex-1 rounded-2xl border border-slate-200 px-4 py-3 sm:min-w-[220px]'
								value={classCode}
								onChange={e => setClassCode(e.target.value.toUpperCase())}
								placeholder='Введите код класса'
							/>
							<button
								onClick={joinClass}
								className='brand-button-primary w-full sm:w-auto'
							>
								Подключить класс
							</button>
						</div>
					) : (
						<p className='mt-5 text-sm leading-7 text-slate-600'>
							Вступить в класс по коду могут только ученики. Созданием групп и
							учениками в классе управляет раздел «Учитель».
						</p>
					)}

					<div className='mt-5 grid gap-3 md:grid-cols-2'>
						{data.my_classes.length ? (
							data.my_classes.map(classroom => (
								<div
									key={classroom.id}
									className='teacher-workspace__item rounded-[24px] border border-slate-200 bg-slate-50 p-4'
									data-motion-item
								>
									<div className='min-w-0'>
										<p className='break-words text-lg font-black text-slate-900'>
											{classroom.name}
										</p>
										<p className='mt-2 text-sm text-slate-600'>
											Код: {classroom.code}
										</p>
										<p className='mt-1 text-sm text-slate-500'>
											Заданий: {classroom.assignments_count} · Учеников:{' '}
											{classroom.students_count}
										</p>
									</div>
								</div>
							))
						) : (
							<p className='text-sm text-slate-500'>
								{isStudent
									? 'Пока нет подключённых классов. Введите код, полученный от вашего учителя.'
									: 'Здесь отображаются классы, в которых вы состоите как ученик. Управление своими классами — в разделе «Учитель».'}
							</p>
						)}
					</div>

					<div className='mt-8 space-y-3'>
						{data.assignments_preview.length > 0 ? (
							data.assignments_preview.map(assignment => (
								<div
									key={assignment.id}
									className='overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm'
								>
									{assignment.image_url ? (
										// eslint-disable-next-line @next/next/no-img-element
										<img
											src={assignment.image_url}
											alt={`Обложка задания «${assignment.title}»`}
											className='h-32 w-full object-cover sm:h-40'
											loading='lazy'
										/>
									) : null}
									<div className='p-4'>
									<div className='flex flex-wrap items-start justify-between gap-3'>
										<div>
											<p className='break-words text-lg font-black text-slate-900'>
												{assignment.title}
											</p>
											<p className='mt-1 text-sm text-slate-500'>
												{assignment.classroom_name}
											</p>
										</div>
										<span className='brand-chip brand-chip--soft'>
											{assignment.difficulty}
										</span>
									</div>

									<p className='mt-3 text-sm leading-7 text-slate-600'>
										{assignment.description}
									</p>

									<div className='mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600'>
										<span className='rounded-full bg-slate-50 px-3 py-1'>
											Срок: {assignment.due_date || 'без срока'}
										</span>
										<span className='rounded-full bg-violet-50 px-3 py-1 text-violet-700'>
											{assignment.assignment_type_label}
										</span>
										{assignment.lesson?.title && (
											<span className='rounded-full bg-sky-50 px-3 py-1 text-sky-700'>
												Урок: {assignment.lesson.title}
											</span>
										)}
										{assignment.lesson_state && (
											<span className='rounded-full bg-emerald-50 px-3 py-1 text-emerald-700'>
												Статус: {lessonStateLabel(assignment.lesson_state)}
											</span>
										)}
									</div>

									<div className='mt-4 flex flex-wrap gap-2'>
										{assignment.lesson_id && assignment.lesson_accessible ? (
											<Link
												href={`/lessons/${assignment.lesson_id}`}
												className='brand-button-primary w-full sm:w-auto'
											>
												Открыть урок
											</Link>
										) : assignment.lesson_id ? (
											<span className='rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500'>
												Урок пока закрыт
											</span>
										) : (
											<span className='rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500'>
												Урок не привязан
											</span>
										)}

										{assignment.submission ? (
											<span
												className={`rounded-full px-4 py-2 text-sm font-semibold ${
													assignment.submission.status === 'needs_revision'
														? 'bg-amber-100 text-amber-700'
														: assignment.submission.status === 'checked'
															? 'bg-emerald-100 text-emerald-700'
															: 'bg-sky-100 text-sky-700'
												}`}
											>
												{submissionStatusLabel(assignment.submission.status)}
											</span>
										) : (
											<span className='rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-700'>
												Ждёт выполнения
											</span>
										)}
									</div>
									</div>
								</div>
							))
						) : (
							<p className='text-sm text-slate-500'>
								Пока нет заданий от учителя. Когда они появятся, здесь появятся
								задания.
							</p>
						)}
					</div>
				</article>

				{data.user.role === 'student' ? (
					<article className='codequest-card p-6' data-motion-item>
						<p className='brand-eyebrow'>Семья</p>
						<h3 className='mt-3 text-2xl font-black text-slate-900'>
							Родительский кабинет и семейная ссылка
						</h3>
						<p className='mt-3 text-sm leading-7 text-slate-600'>
							Подключите родителя к прогрессу ребёнка, чтобы он видел модули,
							активность и общую динамику без лишней нагрузки на вас.
						</p>

						<div className='mt-5 rounded-[26px] bg-slate-50 p-5'>
							{data.parent_link_code?.active ? (
								<div className='space-y-3 text-sm text-slate-700'>
									<p>
										Семейный код для родителя действует до{' '}
										<span className='font-semibold text-slate-900'>
											{data.parent_link_code.expires_at ? (
												<UserLocalTime
													iso={data.parent_link_code.expires_at}
													variant='parentExpiry'
												/>
											) : (
												'—'
											)}
										</span>
										. Пока срок не истёк и код не введён родителем, вы можете
										скопировать его здесь; при необходимости создайте новый —
										старый перестанет действовать.
									</p>
									{revealedParentLinkCode ? (
										<div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
											<p
												className='select-all font-mono text-base font-bold tracking-wide text-slate-900'
												translate='no'
											>
												{formatParentLinkCodeForDisplay(revealedParentLinkCode.code)}
											</p>
											<button
												type='button'
												onClick={() => void copyRevealedParentLinkCode()}
												className='rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50'
											>
												Скопировать код
											</button>
										</div>
									) : (
										<p className='text-sm text-slate-600'>
											Текущий код был создан раньше в этом браузере без сохранения
											или на другом устройстве. Нажмите «Создать или обновить код»,
											чтобы получить новый и увидеть его здесь.
										</p>
									)}
								</div>
							) : (
								<p className='text-sm text-slate-500'>Семейный код ещё не создавался.</p>
							)}
						</div>
						<p className='mt-3 text-sm text-slate-600'>
							Пусть родитель зарегистрируется с ролью «Родитель» и введёт код в{' '}
							<Link className='font-semibold text-sky-700' href='/parent/dashboard'>
								семейном кабинете
							</Link>
							.
						</p>
						<button
							type='button'
							onClick={createParentLinkCode}
							className='brand-button-primary mt-4 w-full sm:w-auto'
						>
							Создать или обновить код
						</button>
					</article>
				) : null}
			</section>

			{showcaseOpen && (
				<AchievementShowcase onClose={() => setShowcaseOpen(false)} />
			)}
		</div>
	)
}
