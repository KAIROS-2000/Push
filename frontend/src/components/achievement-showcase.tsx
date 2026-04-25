'use client'

import { api } from '@/lib/api'
import { X, Trophy, Medal } from 'lucide-react'
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
			className='flex flex-col items-center gap-1 text-center'
			title={item.description}
		>
			<div
				className={`flex h-16 w-16 items-center justify-center rounded-full transition-all ${
					item.earned
						? isCup
							? 'bg-amber-100 text-amber-500 shadow-md shadow-amber-200'
							: 'bg-violet-100 text-violet-500 shadow-md shadow-violet-200'
						: 'bg-slate-100 text-slate-300'
				}`}
			>
				{isCup ? (
					<Trophy size={30} strokeWidth={1.8} />
				) : (
					<Medal size={30} strokeWidth={1.8} />
				)}
			</div>
			<p
				className={`mt-1 max-w-[80px] text-xs font-bold leading-tight ${
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
			<div className='grid grid-cols-4 gap-3 rounded-t-2xl bg-amber-50 px-6 pb-5 pt-6 sm:grid-cols-4'>
				{items.map(item => (
					<ShelfItem key={item.id} item={item} />
				))}
				{Array.from({ length: 4 - items.length }).map((_, i) => (
					<div key={`empty-${i}`} />
				))}
			</div>
			<div className='h-3 rounded-b-xl bg-amber-800/25 shadow-inner' />
		</div>
	)
}

export function AchievementShowcase({ onClose }: AchievementShowcaseProps) {
	const [achievements, setAchievements] = useState<AchievementItem[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		api<{ achievements: AchievementItem[] }>('/achievements', {}, 'required')
			.then(data => setAchievements(data.achievements))
			.finally(() => setLoading(false))
	}, [])

	const earned = achievements.filter(a => a.earned)
	const shelves: AchievementItem[][] = []
	for (let i = 0; i < achievements.length; i += 4) {
		shelves.push(achievements.slice(i, i + 4))
	}

	return (
		<div
			className='fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center'
			onClick={e => e.target === e.currentTarget && onClose()}
		>
			<div className='codequest-card w-full max-w-xl max-h-[90vh] overflow-y-auto'>
				<div className='flex items-start justify-between p-6 pb-4'>
					<div>
						<p className='brand-eyebrow'>Коллекция</p>
						<h2 className='mt-1 text-2xl font-black text-slate-900'>
							Витрина достижений
						</h2>
						{!loading && (
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
						onClick={onClose}
						className='rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700'
						aria-label='Закрыть'
					>
						<X size={20} />
					</button>
				</div>

				{loading ? (
					<div className='p-6 pt-2 text-sm text-slate-500'>Загрузка…</div>
				) : achievements.length === 0 ? (
					<div className='p-6 pt-2 text-sm text-slate-500'>
						Достижения не найдены.
					</div>
				) : (
					<div className='space-y-4 px-6 pb-6'>
						<div className='flex gap-4 text-xs text-slate-500'>
							<span className='flex items-center gap-1'>
								<Trophy size={12} className='text-amber-400' /> Кубок — более 100 XP
							</span>
							<span className='flex items-center gap-1'>
								<Medal size={12} className='text-violet-400' /> Медаль — до 100 XP
							</span>
						</div>
						<div className='space-y-5'>
							{shelves.map((shelf, i) => (
								<Shelf key={i} items={shelf} />
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
