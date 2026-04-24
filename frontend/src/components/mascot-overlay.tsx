'use client'

import { useAppTheme } from '@/hooks/use-app-theme'
import {
	MASCOT_QUEUE_EVENT,
	MascotScenario,
	popMascotScenario,
} from '@/lib/mascot'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

interface MascotStep {
	image: string
	mood: string
	message: string
}

const STEP_DELAY_MS = 3000

const SCENARIOS: Record<MascotScenario, MascotStep[]> = {
	post_register_intro: [
		{
			image: 'Взволнованный.png',
			mood: 'Проги',
			message:
				'Привет! Меня зовут Проги. Я живу на этом сайте и мне срочно нужна твоя помощь!!!',
		},
		{
			image: 'Нейтральный.png',
			mood: 'Проги',
			message: 'Мне не хватает XP, которые нужны мне для зарядки магии',
		},
		{
			image: 'Радостный 1.png',
			mood: 'Проги',
			message:
				'Скорее переходи в раздел с уроками, зарабатывай XP и помоги мне одолеть зло!',
		},
	],
	first_lesson_complete: [
		{
			image: 'Радостный 2.png',
			mood: 'Проги',
			message:
				'Это было потрясающе! Большое тебе спасибо, буду рад видеть тебя снова!',
		},
	],
}

function spriteUrl(filename: string) {
	return `/api/mascot/${encodeURIComponent(filename)}`
}

export function MascotOverlay() {
	const theme = useAppTheme()
	const isDark = theme === 'dark'
	const pathname = usePathname()
	const [activeScenario, setActiveScenario] = useState<MascotScenario | null>(
		null,
	)
	const [stepIndex, setStepIndex] = useState(0)
	const [canAdvance, setCanAdvance] = useState(false)
	const [queueVersion, setQueueVersion] = useState(0)

	useEffect(() => {
		function handleQueueUpdated() {
			setQueueVersion(current => current + 1)
		}

		window.addEventListener(MASCOT_QUEUE_EVENT, handleQueueUpdated)
		return () =>
			window.removeEventListener(MASCOT_QUEUE_EVENT, handleQueueUpdated)
	}, [])

	useEffect(() => {
		if (!pathname || pathname.startsWith('/auth') || activeScenario) return

		const nextScenario = popMascotScenario()
		if (!nextScenario) return

		setActiveScenario(nextScenario)
		setStepIndex(0)
		setCanAdvance(false)
	}, [activeScenario, pathname, queueVersion])

	useEffect(() => {
		if (!activeScenario) return

		setCanAdvance(false)
		const timer = window.setTimeout(() => setCanAdvance(true), STEP_DELAY_MS)
		return () => window.clearTimeout(timer)
	}, [activeScenario, stepIndex])

	useEffect(() => {
		if (!activeScenario || typeof document === 'undefined') return

		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'

		return () => {
			document.body.style.overflow = previousOverflow
		}
	}, [activeScenario])

	if (!activeScenario) return null

	const steps = SCENARIOS[activeScenario]
	const currentStep = steps[stepIndex]

	function handleAdvance() {
		if (!canAdvance) return

		if (stepIndex < steps.length - 1) {
			setStepIndex(current => current + 1)
			return
		}

		setActiveScenario(null)
		setStepIndex(0)
		setCanAdvance(false)
	}

	return (
		<div
			className={clsx(
				'fixed inset-0 z-[100] flex h-[100dvh] w-screen items-center justify-center overflow-hidden backdrop-blur-sm',
				isDark ? 'bg-black/75' : 'bg-slate-950/70',
			)}
			onClick={handleAdvance}
			onKeyDown={event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault()
					handleAdvance()
				}
			}}
			role='button'
			tabIndex={0}
			aria-label='Диалог с Проги'
		>
			<div
				className={clsx(
					'pointer-events-none absolute inset-0',
					isDark
						? 'bg-[radial-gradient(circle_at_top,_rgba(47,129,247,0.2),_rgba(1,4,9,0.92)_52%)]'
						: 'bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.28),_rgba(15,23,42,0.94)_56%)]',
				)}
			/>

			<div className='relative flex h-full max-h-[100dvh] w-full flex-col gap-4 overflow-hidden px-4 py-4 sm:gap-6 sm:px-6 sm:py-6 lg:grid lg:grid-cols-[minmax(320px,460px)_minmax(0,1fr)] lg:gap-8 lg:px-12 lg:py-10'>
				<div
					className={clsx(
						'flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[32px] p-3 backdrop-blur-md sm:p-5 lg:flex-none lg:h-full lg:p-8',
						isDark
							? 'border border-white/[0.08] bg-white/[0.04] shadow-2xl shadow-black/50'
							: 'border border-white/15 bg-white/10 shadow-2xl shadow-slate-950/30',
					)}
				>
					<div
						className={clsx(
							'flex h-full max-h-full w-full items-center justify-center overflow-hidden rounded-[28px]',
							isDark
								? 'border border-[var(--border-default)] bg-[var(--surface-muted)] shadow-[0_20px_60px_rgba(0,0,0,0.55)]'
								: 'border border-white/50 bg-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.18)]',
						)}
					>
						<img
							key={currentStep.image}
							src={spriteUrl(currentStep.image)}
							alt={currentStep.mood}
							className='block h-auto max-h-full w-auto max-w-full rounded-[28px] object-contain'
						/>
					</div>
				</div>

				<div className='flex min-h-0 shrink-0 items-center overflow-hidden lg:h-full'>
					<div
						className={clsx(
							'w-full max-h-full overflow-y-auto rounded-[36px] p-5 backdrop-blur-xl sm:p-8 lg:p-12',
							isDark
								? 'border border-[var(--border-default)] bg-[var(--surface-overlay-strong)] shadow-2xl shadow-black/40'
								: 'border border-white/15 bg-white/92 shadow-2xl shadow-slate-950/25',
						)}
					>
						<p
							className={clsx(
								'text-xs font-bold uppercase tracking-[0.28em]',
								isDark ? 'text-[var(--brand)]' : 'text-sky-600',
							)}
						>
							Проги
						</p>
						<h2
							className={clsx(
								'mt-3 text-2xl font-black tracking-tight sm:text-4xl lg:text-5xl',
								isDark ? 'text-[var(--fg)]' : 'text-slate-900',
							)}
						>
							{currentStep.mood}
						</h2>
						<p
							className={clsx(
								'mt-4 max-w-3xl text-base leading-7 sm:mt-6 sm:text-xl sm:leading-9 lg:text-2xl lg:leading-10',
								isDark ? 'text-[#c9d1d9]' : 'text-slate-700',
							)}
						>
							{currentStep.message}
						</p>
						{canAdvance && (
							<p
								className={clsx(
									'mt-6 text-xs font-semibold uppercase tracking-[0.22em] sm:mt-8 sm:text-sm',
									isDark ? 'text-[var(--fg-muted)]' : 'text-slate-400',
								)}
							>
								Нажми в любое место экрана
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
