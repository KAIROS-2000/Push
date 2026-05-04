'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
	ArrowRight,
	Binary,
	BookOpen,
	Braces,
	Calculator,
	Code2,
	Database,
	Gamepad2,
	GitBranch,
	LayoutTemplate,
	Library,
	Paintbrush,
	Rocket,
	Search,
	Shield,
	Target,
	Terminal,
	X,
} from 'lucide-react'

import { api, getApiErrorMessage } from '@/lib/api'
import { useSessionUser } from '@/lib/auth-session'
import type { UsefulAgeGroup, UsefulDifficulty, UsefulTaskItem, UsefulTaskListResponse } from '@/types'

const AGE_GROUP_LABELS: Record<UsefulAgeGroup | 'all', string> = {
	all: 'Все возрасты',
	junior: '10–12 лет',
	middle: '13–15 лет',
	senior: '16–17 лет',
}

const DIFFICULTY_LABELS: Record<UsefulDifficulty | 'all', string> = {
	all: 'Любая сложность',
	easy: 'Лёгкая',
	medium: 'Средняя',
	hard: 'Сложная',
}

const DIFFICULTY_STYLES: Record<UsefulDifficulty, { badge: string; bar: string; glow: string }> = {
	easy: {
		badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
		bar: 'bg-emerald-400',
		glow: 'hover:border-emerald-300 hover:shadow-emerald-100',
	},
	medium: {
		badge: 'bg-amber-50 text-amber-700 border border-amber-200',
		bar: 'bg-amber-400',
		glow: 'hover:border-amber-300 hover:shadow-amber-100',
	},
	hard: {
		badge: 'bg-rose-50 text-rose-700 border border-rose-200',
		bar: 'bg-rose-400',
		glow: 'hover:border-rose-300 hover:shadow-rose-100',
	},
}

const DIFFICULTY_DOTS: Record<UsefulDifficulty, number> = { easy: 1, medium: 2, hard: 3 }

/** Схлопывает пустые колонки на широких экранах: одна карточка не «залипает» в 1/3 ширины (как при xl:grid-cols-3). */
const USEFUL_TASKS_GRID =
	'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]'

const TOPIC_ICON_MAP: Record<string, LucideIcon> = {
	python: Code2,
	javascript: Braces,
	html: LayoutTemplate,
	css: Paintbrush,
	алгоритмы: Binary,
	algoritms: Binary,
	algorithms: Binary,
	математика: Calculator,
	math: Calculator,
	игры: Gamepad2,
	games: Gamepad2,
	проекты: Rocket,
	projects: Rocket,
	практика: Target,
	practice: Target,
	теория: BookOpen,
	theory: BookOpen,
	базы: Database,
	database: Database,
	git: GitBranch,
	linux: Terminal,
	безопасность: Shield,
	security: Shield,
	general: Library,
}

function TopicGlyph({
	topic,
	size = 16,
	className = '',
}: {
	topic: string
	size?: number
	className?: string
}) {
	const Icon = TOPIC_ICON_MAP[topic.trim().toLowerCase()] ?? Library
	return <Icon className={className} size={size} strokeWidth={1.75} aria-hidden />
}

function SkeletonCard() {
	return (
		<div className='overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm animate-pulse'>
			<div className='h-2 w-full bg-slate-100' />
			<div className='p-5'>
				<div className='h-3 w-16 rounded-full bg-slate-100' />
				<div className='mt-3 h-5 w-3/4 rounded-lg bg-slate-100' />
				<div className='mt-2 space-y-2'>
					<div className='h-3 w-full rounded bg-slate-100' />
					<div className='h-3 w-5/6 rounded bg-slate-100' />
				</div>
				<div className='mt-4 flex gap-2'>
					<div className='h-6 w-16 rounded-full bg-slate-100' />
					<div className='h-6 w-20 rounded-full bg-slate-100' />
				</div>
				<div className='mt-4 h-9 w-full rounded-2xl bg-slate-100' />
			</div>
		</div>
	)
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
	const Icon = hasFilters ? Search : Library
	return (
		<div className='flex flex-col items-center justify-center py-20 text-center'>
			<div className='flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400'>
				<Icon className='h-8 w-8' strokeWidth={1.5} aria-hidden />
			</div>
			<p className='mt-4 text-lg font-bold text-slate-700'>
				{hasFilters ? 'Ничего не нашлось' : 'Подборка пока пуста'}
			</p>
			<p className='mt-2 max-w-xs text-sm leading-6 text-slate-500'>
				{hasFilters
					? 'Попробуйте изменить фильтры или очистить поиск — материалы точно есть.'
					: 'Скоро здесь появятся практики, статьи и тренажёры. Загляните позже.'}
			</p>
		</div>
	)
}

function DifficultyDots({ difficulty }: { difficulty: UsefulDifficulty }) {
	const count = DIFFICULTY_DOTS[difficulty] ?? 1
	const style = DIFFICULTY_STYLES[difficulty]
	return (
		<div className='flex items-center gap-0.5'>
			{[1, 2, 3].map(i => (
				<span
					key={i}
					className={`inline-block h-2 w-2 rounded-full transition-all ${i <= count ? style.bar : 'bg-slate-200'}`}
				/>
			))}
		</div>
	)
}

function TaskCard({ task }: { task: UsefulTaskItem }) {
	const difficulty = task.difficulty as UsefulDifficulty
	const style = DIFFICULTY_STYLES[difficulty] ?? DIFFICULTY_STYLES.medium

	return (
		<article
			className={`group relative flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${style.glow}`}
		>
			{/* difficulty colour bar */}
			<div className={`h-1 w-full ${style.bar}`} />

			{task.image_url ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={task.image_url}
					alt=''
					className='h-36 w-full object-cover'
					loading='lazy'
					aria-hidden='true'
				/>
			) : null}

			<div className='flex flex-1 flex-col p-5'>
				{/* topic chip */}
				{task.topic ? (
					<p className='flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-slate-400'>
						<TopicGlyph topic={task.topic} size={14} className='shrink-0 text-sky-600' />
						<span>{task.topic}</span>
					</p>
				) : null}

				<h3 className='mt-2 text-base font-black leading-snug text-slate-900 group-hover:text-sky-700 transition-colors'>
					{task.title}
				</h3>

				{task.summary ? (
					<p className='mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-500'>
						{task.summary}
					</p>
				) : null}

				{/* tags row */}
				<div className='mt-4 flex flex-wrap items-center gap-2'>
					<span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style.badge}`}>
						<DifficultyDots difficulty={difficulty} />
						{DIFFICULTY_LABELS[difficulty]}
					</span>
					{task.age_groups.map(group => (
						<span
							key={group}
							className='rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700'
						>
							{AGE_GROUP_LABELS[group]}
						</span>
					))}
				</div>

				{task.external_url ? (
					<a
						href={task.external_url}
						target='_blank'
						rel='noopener noreferrer'
						className='mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-sky-700 hover:shadow-md'
					>
						Открыть материал
						<ArrowRight className='h-3.5 w-3.5 opacity-70' strokeWidth={2} aria-hidden />
					</a>
				) : null}
			</div>
		</article>
	)
}

export function UsefulTasksPage() {
	const { user, status } = useSessionUser({ auth: 'required' })
	const [items, setItems] = useState<UsefulTaskItem[]>([])
	const [ageGroup, setAgeGroup] = useState<UsefulAgeGroup | 'all'>('all')
	const [difficulty, setDifficulty] = useState<UsefulDifficulty | 'all'>('all')
	const [search, setSearch] = useState('')
	/** Первый заход — полноэкранные скелетоны; дальше список остаёт на месте, без рывка. */
	const [initialLoading, setInitialLoading] = useState(true)
	const [refreshing, setRefreshing] = useState(false)
	const [loadErr, setLoadErr] = useState('')
	const firstLoadDoneRef = useRef(false)

	useEffect(() => {
		if (user?.role === 'student' && user.age_group) {
			setAgeGroup(user.age_group as UsefulAgeGroup)
		}
	}, [user])

	const load = useCallback(async () => {
		const isFirst = !firstLoadDoneRef.current
		if (isFirst) setInitialLoading(true)
		else setRefreshing(true)
		setLoadErr('')
		try {
			const params = new URLSearchParams()
			if (ageGroup !== 'all') params.set('age_group', ageGroup)
			if (difficulty !== 'all') params.set('difficulty', difficulty)
			const trimmed = search.trim()
			if (trimmed) params.set('q', trimmed)
			params.set('limit', '50')
			const data = await api<UsefulTaskListResponse>(
				`/useful${params.toString() ? `?${params.toString()}` : ''}`,
				undefined,
				'required',
			)
			setItems(data.tasks || [])
			firstLoadDoneRef.current = true
		} catch (e) {
			setLoadErr(getApiErrorMessage(e, 'Не удалось загрузить подборку.'))
		} finally {
			setInitialLoading(false)
			setRefreshing(false)
		}
	}, [ageGroup, difficulty, search])

	useEffect(() => {
		if (status === 'unknown') return
		if (!user) return
		void load()
	}, [load, user, status])

	const grouped = useMemo(() => {
		const map = new Map<string, UsefulTaskItem[]>()
		for (const item of items) {
			const key = item.topic || 'general'
			const bucket = map.get(key) ?? []
			bucket.push(item)
			map.set(key, bucket)
		}
		return Array.from(map.entries())
	}, [items])

	const hasFilters = ageGroup !== 'all' || difficulty !== 'all' || search.trim() !== ''

	const countByDifficulty = useMemo(() => {
		const counts: Record<string, number> = { easy: 0, medium: 0, hard: 0 }
		for (const item of items) counts[item.difficulty] = (counts[item.difficulty] ?? 0) + 1
		return counts
	}, [items])

	if (status === 'unknown' || !user) {
		return (
			<main className='page-shell mx-auto w-full max-w-[80rem] py-6'>
				<div className='codequest-card p-8 text-center text-sm text-slate-500'>Загружаем подборку…</div>
			</main>
		)
	}

	return (
		<main className='page-shell mx-auto w-full max-w-[80rem] space-y-6 py-6'>

			{/* ── Hero header ────────────────────────────────────────────── */}
			<header className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-sky-900 p-6 text-white shadow-xl sm:p-8'>
				{/* decorative blobs */}
				<div className='pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl' />
				<div className='pointer-events-none absolute -bottom-8 left-1/3 h-48 w-48 rounded-full bg-indigo-500/10 blur-2xl' />

				<p className='text-xs font-bold uppercase tracking-[0.2em] text-sky-400'>Самостоятельная работа</p>
				<h1 className='mt-2 text-3xl font-black leading-tight sm:text-5xl'>
					Полезные задания
				</h1>
				<p className='mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base'>
					Курируемая подборка практик, статей и тренажёров — для ученика, родителя и учителя.
					Выходите за рамки обязательного расписания и находите материал по интересу.
				</p>

				{/* stats pills */}
				{items.length > 0 ? (
					<div className='mt-5 flex flex-wrap gap-3'>
						<div className='flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-sm backdrop-blur-sm'>
							<BookOpen className='h-4 w-4 shrink-0 text-sky-300' strokeWidth={1.75} aria-hidden />
							<span className='font-bold'>{items.length}</span>
							<span className='text-slate-300'>материалов</span>
						</div>
						{countByDifficulty.easy > 0 && (
							<div className='flex items-center gap-2 rounded-2xl bg-emerald-500/20 px-4 py-2 text-sm text-emerald-300'>
								<span className='h-2 w-2 rounded-full bg-emerald-400' />
								{countByDifficulty.easy} лёгких
							</div>
						)}
						{countByDifficulty.medium > 0 && (
							<div className='flex items-center gap-2 rounded-2xl bg-amber-500/20 px-4 py-2 text-sm text-amber-300'>
								<span className='h-2 w-2 rounded-full bg-amber-400' />
								{countByDifficulty.medium} средних
							</div>
						)}
						{countByDifficulty.hard > 0 && (
							<div className='flex items-center gap-2 rounded-2xl bg-rose-500/20 px-4 py-2 text-sm text-rose-300'>
								<span className='h-2 w-2 rounded-full bg-rose-400' />
								{countByDifficulty.hard} сложных
							</div>
						)}
					</div>
				) : null}
			</header>

			{/* ── Filters ─────────────────────────────────────────────────── */}
			<section
				className={`codequest-card relative space-y-4 p-4 sm:p-5 transition-shadow duration-300 ${
					refreshing ? 'ring-2 ring-sky-200/60 shadow-sm' : ''
				}`}
			>
				{refreshing ? (
					<div
						className='pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden rounded-t-[inherit] bg-slate-100'
						aria-hidden
					>
						<div className='useful-tab-shimmer h-full w-1/3 bg-gradient-to-r from-transparent via-sky-400/90 to-transparent' />
					</div>
				) : null}
				{/* age group tabs */}
				<div className='flex flex-wrap gap-2'>
					{(Object.keys(AGE_GROUP_LABELS) as Array<UsefulAgeGroup | 'all'>).map(group => (
						<button
							key={group}
							type='button'
							onClick={() => setAgeGroup(group)}
							aria-pressed={ageGroup === group}
							className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-all ${
								ageGroup === group
									? 'bg-sky-600 text-white shadow-sm shadow-sky-200'
									: 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
							}`}
						>
							{AGE_GROUP_LABELS[group]}
						</button>
					))}
				</div>

				{/* difficulty + search */}
				<div className='flex flex-wrap items-center gap-2'>
					{(['all', 'easy', 'medium', 'hard'] as const).map(d => (
						<button
							key={d}
							type='button'
							onClick={() => setDifficulty(d)}
							aria-pressed={difficulty === d}
							className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
								difficulty === d
									? d === 'easy'
										? 'border-emerald-400 bg-emerald-50 text-emerald-700'
										: d === 'medium'
											? 'border-amber-400 bg-amber-50 text-amber-700'
											: d === 'hard'
												? 'border-rose-400 bg-rose-50 text-rose-700'
												: 'border-sky-400 bg-sky-50 text-sky-700'
									: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
							}`}
						>
							{DIFFICULTY_LABELS[d]}
						</button>
					))}

					<div className='flex flex-1 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100 transition-all min-w-[180px]'>
						<Search className='h-3.5 w-3.5 shrink-0 text-slate-400' strokeWidth={2} aria-hidden />
						<input
							type='search'
							value={search}
							onChange={e => setSearch(e.target.value)}
							onKeyDown={e => { if (e.key === 'Enter') void load() }}
							placeholder='Поиск по названию…'
							className='w-full bg-transparent text-sm outline-none placeholder:text-slate-400'
						/>
						{search ? (
							<button
								type='button'
								onClick={() => setSearch('')}
								className='shrink-0 rounded-full p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700'
								aria-label='Очистить'
							>
								<X className='h-4 w-4' strokeWidth={2} aria-hidden />
							</button>
						) : null}
					</div>

					<button
						type='button'
						onClick={() => void load()}
						className='shrink-0 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900 transition-all'
					>
						Обновить
					</button>
				</div>
			</section>

			{/* ── Error ───────────────────────────────────────────────────── */}
			{loadErr ? (
				<div className='rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800'>
					{loadErr}
				</div>
			) : null}

			<div
				className={`transition-opacity duration-300 ease-out motion-reduce:transition-none ${
					refreshing ? 'opacity-55' : 'opacity-100'
				}`}
				aria-busy={refreshing}
			>
				{initialLoading ? (
					<div className={USEFUL_TASKS_GRID}>
						{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
					</div>
				) : null}

				{/* ── Empty state ──────────────────────────────────────────────── */}
				{!initialLoading && !refreshing && items.length === 0 ? (
					<div className='codequest-card'>
						<EmptyState hasFilters={hasFilters} />
					</div>
				) : null}

				{/* ── Grouped content ─────────────────────────────────────────── */}
				{!initialLoading && grouped.length > 0
					? grouped.map(([topic, list]) => (
						<section key={topic} className='useful-topic-section'>
							{/* section header */}
							<div className='mb-4 flex items-center gap-3'>
								<div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600'>
									<TopicGlyph topic={topic} size={18} />
								</div>
								<div>
									<p className='text-xs font-bold uppercase tracking-widest text-slate-400'>Тема</p>
									<h2 className='text-lg font-black text-slate-900 capitalize'>
										{topic === 'general' ? 'Общая подборка' : topic}
									</h2>
								</div>
								<span className='ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500'>
									{list.length}
								</span>
							</div>

							<ul className={USEFUL_TASKS_GRID}>
								{list.map(task => (
									<li key={task.id}>
										<TaskCard task={task} />
									</li>
								))}
							</ul>
						</section>
					))
					: null}
			</div>
		</main>
	)
}
