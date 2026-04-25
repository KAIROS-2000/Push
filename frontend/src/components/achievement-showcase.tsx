'use client'

import { api, getApiErrorMessage } from '@/lib/api'
import { Medal, Trophy, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface AchievementItem {
	id: number
	name: string
	description: string
	xp_reward: number
	earned: boolean
}

interface AchievementShowcaseProps {
	onClose: () => void
}

function ShelfItem({ item }: { item: AchievementItem }) {
	const isCup = item.xp_reward > 100

	return (
		<div
			className='flex min-w-0 flex-col items-center gap-1 text-center'
			title={item.description}
		>
			<div
				className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-all sm:h-16 sm:w-16 ${
					item.earned
						? isCup
							? 'bg-amber-100 text-amber-500 shadow-md shadow-amber-200'
							: 'bg-violet-100 text-violet-500 shadow-md shadow-violet-200'
						: 'bg-slate-100 text-slate-300'
				}`}
			>
				{isCup ? (
					<Trophy className='h-7 w-7 sm:h-[30px] sm:w-[30px]' strokeWidth={1.8} />
				) : (
					<Medal className='h-7 w-7 sm:h-[30px] sm:w-[30px]' strokeWidth={1.8} />
				)}
			</div>
			<p
				className={`mt-1 w-full min-w-0 break-words text-[11px] font-bold leading-tight sm:text-xs ${
					item.earned ? 'text-slate-800' : 'text-slate-400'
				}`}
			>
				{item.name}
			</p>
			<p
				className={`text-xs font-semibold ${
					item.earned
						? isCup
							? 'text-amber-600'
							: 'text-violet-600'
						: 'text-slate-300'
				}`}
			>
				+{item.xp_reward} XP
			</p>
		</div>
	)
}

function Shelf({ items }: { items: AchievementItem[] }) {
	return (
		<div>
			<div className='grid grid-cols-2 gap-x-4 gap-y-5 rounded-t-2xl bg-amber-50 px-4 pb-5 pt-6 sm:grid-cols-4 sm:gap-3 sm:px-6'>
				{items.map(item => (
					<ShelfItem key={item.id} item={item} />
				))}
				{Array.from({ length: Math.max(0, 4 - items.length) }).map(
					(_, index) => (
						<div key={`empty-${index}`} className='hidden sm:block' />
					),
				)}
			</div>
			<div className='h-3 rounded-b-xl bg-amber-800/25 shadow-inner' />
		</div>
	)
}

export function AchievementShowcase({ onClose }: AchievementShowcaseProps) {
	const [achievements, setAchievements] = useState<AchievementItem[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	useEffect(() => {
		let mounted = true

		api<{ achievements: AchievementItem[] }>(
			'/achievements',
			undefined,
			'required',
		)
			.then(data => {
				if (mounted) setAchievements(data.achievements)
			})
			.catch(error => {
				if (mounted) {
					setError(getApiErrorMessage(error, 'Не удалось загрузить достижения.'))
				}
			})
			.finally(() => {
				if (mounted) setLoading(false)
			})

		return () => {
			mounted = false
		}
	}, [])

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				onClose()
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [onClose])

	const earned = achievements.filter(achievement => achievement.earned)
	const shelves: AchievementItem[][] = []
	for (let index = 0; index < achievements.length; index += 4) {
		shelves.push(achievements.slice(index, index + 4))
	}

	return (
		<div
			className='fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center'
			onClick={event => event.target === event.currentTarget && onClose()}
		>
			<div className='codequest-card max-h-[90vh] w-full max-w-xl overflow-y-auto'>
				<div className='flex items-start justify-between p-6 pb-4'>
					<div>
						<p className='brand-eyebrow'>Коллекция</p>
						<h2 className='mt-1 text-2xl font-black text-slate-900'>
							Витрина достижений
						</h2>
						{!loading && !error && (
							<p className='mt-1 text-sm text-slate-500'>
								Получено{' '}
								<span className='font-bold text-slate-800'>{earned.length}</span>{' '}
								из{' '}
								<span className='font-bold text-slate-800'>
									{achievements.length}
								</span>
							</p>
						)}
					</div>
					<button
						type='button'
						onClick={onClose}
						className='rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700'
						aria-label='Закрыть'
					>
						<X size={20} />
					</button>
				</div>

				{loading ? (
					<div className='p-6 pt-2 text-sm text-slate-500'>Загрузка...</div>
				) : error ? (
					<div className='p-6 pt-2 text-sm text-rose-600'>{error}</div>
				) : achievements.length === 0 ? (
					<div className='p-6 pt-2 text-sm text-slate-500'>
						Достижения не найдены.
					</div>
				) : (
					<div className='space-y-4 px-6 pb-6'>
						<div className='flex flex-wrap gap-4 text-xs text-slate-500'>
							<span className='flex items-center gap-1'>
								<Trophy size={12} className='text-amber-400' /> Кубок - более
								100 XP
							</span>
							<span className='flex items-center gap-1'>
								<Medal size={12} className='text-violet-400' /> Медаль - до 100
								XP
							</span>
						</div>
						<div className='space-y-5'>
							{shelves.map((shelf, index) => (
								<Shelf key={index} items={shelf} />
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
