'use client'

import { usePrefersReducedMotion } from '@/hooks/use-user-page-motion'
import { ModuleItem } from '@/types'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Link from 'next/link'
import { useEffect, useMemo, useRef } from 'react'

gsap.registerPlugin(ScrollTrigger)

export function RoadmapPunsons({
	title,
	modules,
}: {
	title: string
	modules: ModuleItem[]
}) {
	const ref = useRef<HTMLDivElement>(null)
	const prefersReducedMotion = usePrefersReducedMotion()

	const entries = useMemo(
		() =>
			modules.flatMap(module =>
				module.lessons.map((lesson, index) => ({
					key: `${module.id}-${lesson.id}`,
					module,
					lesson,
					side:
						(lesson.order_index + module.order_index + index) % 2 === 0
							? 'left'
							: 'right',
				})),
			),
		[modules],
	)

	useEffect(() => {
		if (prefersReducedMotion) {
			return
		}

		const ctx = gsap.context(() => {
			gsap.fromTo(
				'.roadmap-node',
				{ opacity: 0, y: 40, scale: 0.92 },
				{
					opacity: 1,
					y: 0,
					scale: 1,
					duration: 0.55,
					stagger: 0.08,
					ease: 'power3.out',
				},
			)

			gsap.to('.roadmap-current', {
				scale: 1.08,
				repeat: -1,
				yoyo: true,
				duration: 1.2,
				ease: 'sine.inOut',
			})
		}, ref)

		return () => ctx.revert()
	}, [entries.length, prefersReducedMotion])

	return (
		<section
			className='brand-roadmap-shell codequest-card overflow-hidden p-6 sm:p-8'
			ref={ref}
			data-motion-reveal
		>
			<div className='flex flex-wrap items-start justify-between gap-4'>
				<div className='min-w-0 flex-1' data-motion-hero-copy>
					<p className='brand-eyebrow'>Learning journey</p>
					<h2 className='mt-3 break-words text-3xl font-black leading-tight text-slate-900 sm:text-4xl'>
						{title}
					</h2>
				</div>
				<div
					className='brand-chip brand-chip--dark w-full justify-center sm:w-auto'
					data-motion-hero-visual
				>
					{entries.length} уроков в маршруте
				</div>
			</div>

			<div className='relative mx-auto mt-8 max-w-5xl pb-8 pt-4'>
				<div className='roadmap-gradient absolute left-5 top-0 h-full w-2 -translate-x-1/2 rounded-full opacity-80 shadow-[0_0_40px_rgba(74,144,217,0.25)] sm:left-1/2 sm:w-3' />
				<div className='space-y-10'>
					{entries.map(({ key, module, lesson, side }) => {
						const state = lesson.state || 'open'
						const isLocked = state === 'locked'
						const isCompleted = state === 'completed'
						const bubbleClass = isCompleted
							? 'bg-emerald-500 text-white ring-emerald-200'
							: state === 'current'
								? 'roadmap-current bg-sky-600 text-white ring-sky-200'
								: isLocked
									? 'bg-slate-300 text-slate-700 ring-slate-100'
									: 'bg-white text-slate-900 ring-sky-100'

						return (
							<div
								key={key}
								className='roadmap-node relative flex items-start justify-center sm:items-center'
							>
								<div
									className={`absolute left-1/2 top-1/2 hidden h-1 w-[17%] -translate-y-1/2 rounded-full bg-slate-200 sm:block ${
										side === 'left' ? '-translate-x-full' : ''
									}`}
								/>
								<div
									className={`flex w-full items-center justify-start pl-12 sm:pl-0 ${
										side === 'left'
											? 'sm:justify-start sm:pr-[52%]'
											: 'sm:justify-end sm:pl-[52%]'
									}`}
								>
									<div
										className={`brand-roadmap-card w-full min-w-0 max-w-full p-4 sm:max-w-sm sm:p-5 ${
											isLocked ? 'opacity-75' : ''
										}`}
										data-motion-hover
									>
										<div className='flex min-w-0 flex-wrap items-start justify-between gap-3'>
											<p className='min-w-0 flex-1 break-words text-[11px] font-bold uppercase leading-4 tracking-[0.18em] text-slate-500 sm:text-xs'>
												{module.title}
											</p>
											<span
												className='shrink-0 rounded-full px-3 py-1 text-center text-xs font-bold text-white'
												style={{ backgroundColor: module.color }}
											>
												{module.age_group}
											</span>
										</div>
										<h3 className='mt-3 break-words text-lg font-black leading-tight text-slate-900 sm:text-xl'>
											{lesson.title}
										</h3>
										<p className='mt-2 break-words text-sm leading-7 text-slate-600'>
											{lesson.summary}
										</p>
										<div className='mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-500'>
											<span>{lesson.duration_minutes} мин</span>
											<span>•</span>
											<span>Порог {lesson.passing_score}%</span>
										</div>
										<div className='mt-4 flex flex-col gap-3 sm:flex-row'>
											<Link
												href={isLocked ? '#' : `/lessons/${lesson.id}`}
												className={`rounded-2xl px-4 py-2 text-center text-sm font-semibold ${
													isLocked
														? 'bg-slate-200 text-slate-500'
														: 'bg-slate-900 text-white'
												}`}
											>
												{isLocked ? 'Заблокировано' : 'Открыть урок'}
											</Link>
											<span className='brand-chip brand-chip--soft justify-center'>
												{state === 'current'
													? 'Текущий'
													: state === 'completed'
														? 'Пройден'
														: isLocked
															? 'После предыдущего'
															: 'Доступен'}
											</span>
										</div>
									</div>
								</div>
								<div
									className={`absolute left-5 top-6 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full ring-4 shadow-lg sm:left-1/2 sm:top-1/2 sm:h-24 sm:w-24 sm:-translate-y-1/2 sm:ring-8 ${bubbleClass}`}
								>
									<div className='w-full px-1 text-center leading-none sm:px-2'>
										<div className='text-xl font-black sm:text-2xl'>
											{lesson.order_index}
										</div>
										<div className='mx-auto mt-0.5 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[8px] font-bold uppercase tracking-[0.08em] sm:mt-1 sm:text-[10px] sm:tracking-[0.18em]'>
											{module.age_group}
										</div>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</div>
		</section>
	)
}
