'use client'

import { RoadmapPunsons } from '@/components/roadmap-punsons'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { api } from '@/lib/api'
import { fetchSessionUser } from '@/lib/auth-session'
import { ModuleItem } from '@/types'
import { useEffect, useRef, useState } from 'react'

const GROUP_LABELS: Record<string, string> = {
	junior: '7-10',
	middle: '11-13',
	senior: '14-15',
}

function normalizeGroup(value: string | null | undefined) {
	return value && value in GROUP_LABELS ? value : 'middle'
}

export default function RoadmapPage() {
	const rootRef = useRef<HTMLElement | null>(null)
	const [group, setGroup] = useState<string | null>(null)
	const [modules, setModules] = useState<ModuleItem[]>([])
	const [error, setError] = useState('')
	const [loading, setLoading] = useState(true)

	useUserPageMotion(rootRef, [group, modules.length, loading, Boolean(error)])

	useEffect(() => {
		let cancelled = false

		fetchSessionUser({ auth: 'required' })
			.then(user => {
				if (!cancelled) {
					setGroup(
						currentGroup => currentGroup ?? normalizeGroup(user?.age_group),
					)
				}
			})
			.catch(e => {
				if (!cancelled) {
					setError(
						e instanceof Error
							? e.message
							: 'Не удалось определить возрастную группу',
					)
					setLoading(false)
				}
			})

		return () => {
			cancelled = true
		}
	}, [])

	useEffect(() => {
		if (!group) return

		let cancelled = false
		setLoading(true)
		setError('')

		api<{ modules: ModuleItem[] }>(
			`/modules?age_group=${group}`,
			undefined,
			true,
		)
			.then(data => {
				if (!cancelled) {
					setModules(data.modules)
				}
			})
			.catch(e => {
				if (!cancelled) {
					setError(
						e instanceof Error ? e.message : 'Не удалось загрузить уроки',
					)
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false)
				}
			})

		return () => {
			cancelled = true
		}
	}, [group])

	return (
		<main ref={rootRef} className='brand-app-shell'>
			<div className='page-shell mx-auto w-full max-w-[96rem]'>
				<section
					className='roadmap-page-hero codequest-card mb-6 overflow-hidden p-6 sm:p-8'
					data-motion-reveal
				>
					<div className='flex flex-wrap items-center justify-between gap-4'>
						<div className='min-w-0 flex-1' data-motion-hero-copy>
							<p className='brand-eyebrow'>Маршрут роста</p>
							<h1 className='mt-3 break-words text-3xl font-black leading-tight text-slate-900 sm:text-4xl'>
								Уроки выстроены как понятный путь от старта к следующему навыку.
							</h1>
						</div>
						<div
							className='flex w-full flex-wrap gap-3 sm:w-auto'
							data-motion-stagger
						>
							{[
								['junior', '7–10'],
								['middle', '11–13'],
								['senior', '14–15'],
							].map(([value, label]) => (
								<button
									key={value}
									onClick={() => setGroup(value)}
									data-motion-item
									className={`rounded-2xl px-4 py-2.5 text-sm font-semibold ${
										group === value
											? 'bg-slate-900 text-white'
											: 'bg-white text-slate-700 shadow-sm'
									}`}
								>
									{label}
								</button>
							))}
						</div>
					</div>
				</section>
				{error ? (
					<div className='codequest-card p-6 text-rose-700'>{error}</div>
				) : loading || !group ? (
					<div className='codequest-card p-6'>Загружаем уроки...</div>
				) : (
					<RoadmapPunsons
						title={`Возраст ${GROUP_LABELS[group] || group}`}
						modules={modules}
					/>
				)}
			</div>
		</main>
	)
}
