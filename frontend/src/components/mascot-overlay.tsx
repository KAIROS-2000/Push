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

			{/* Контент: по центру viewport; max-width, чтобы на широких экранах не «тянуло» влево */}
			<div
				className='relative z-[1] m-auto flex w-full min-h-0 max-h-[100dvh] max-w-5xl flex-col items-stretch justify-center gap-2 overflow-y-auto overflow-x-hidden pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] max-[380px]:gap-1.5 max-[380px]:px-2 sm:gap-3 sm:px-3 md:max-w-6xl md:gap-4 md:px-5 lg:max-h-[100dvh] lg:min-h-0 lg:grid lg:w-full lg:max-w-6xl lg:grid-cols-[minmax(200px,320px)_minmax(0,1fr)] lg:items-center lg:justify-center lg:gap-5 lg:px-6 lg:py-4 xl:max-w-7xl xl:grid-cols-[minmax(220px,360px)_minmax(0,1fr)] xl:gap-6 xl:px-8 2xl:max-w-[80rem] 2xl:grid-cols-[minmax(240px,400px)_minmax(0,1fr)] 2xl:gap-7 min-[2560px]:max-w-[88rem]'
			>
				<div
					className={clsx(
						'flex w-full min-w-0 items-center justify-center rounded-2xl p-1.5 backdrop-blur-md max-[380px]:rounded-[1.05rem] sm:rounded-2xl sm:p-2 md:p-2.5 lg:shrink-0',
						isDark
							? 'border border-white/[0.08] bg-white/[0.04] shadow-2xl shadow-black/50'
							: 'border border-white/15 bg-white/10 shadow-2xl shadow-slate-950/30',
					)}
				>
					{/* Картинка: целиком, без client-side crop — только object-contain внутри max-height */}
					<div
						className={clsx(
							'flex w-full min-w-0 max-w-full items-center justify-center rounded-[1rem] p-0.5 sm:rounded-[1.15rem] lg:rounded-2xl',
							isDark
								? 'border border-[var(--border-default)] bg-[var(--surface-muted)] shadow-[0_20px_60px_rgba(0,0,0,0.55)]'
								: 'border border-white/50 bg-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.18)]',
						)}
					>
						<img
							key={currentStep.image}
							src={spriteUrl(currentStep.image)}
							alt={currentStep.mood}
							className='m-auto h-auto w-full max-h-[min(78dvh,44rem)] max-w-full object-contain object-center [image-rendering:auto] rounded-[0.9rem] sm:rounded-[1.05rem] lg:max-h-[min(80dvh,46rem)] lg:rounded-2xl'
						/>
					</div>
				</div>

				<div className='flex w-full min-w-0 flex-none flex-col items-stretch self-center'>
					<div
						className={clsx(
							'w-full max-w-full min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border px-3.5 py-3.5 shadow-2xl backdrop-blur-xl max-[380px]:rounded-[1.05rem] max-[380px]:px-2.5 max-[380px]:py-2.5 sm:px-4 sm:py-4 md:px-5 md:py-4 lg:max-h-[min(80dvh,40rem)] lg:rounded-2xl lg:px-5 lg:py-4 xl:px-6 xl:py-5 2xl:px-6 2xl:py-5 min-[2560px]:px-7 min-[2560px]:py-5',
							isDark
								? 'border-[var(--border-default)] bg-[var(--surface-overlay-strong)] shadow-black/40'
								: 'border-white/15 bg-white/92 shadow-slate-950/25',
						)}
					>
						<p
							className={clsx(
								'text-[0.65rem] font-bold uppercase leading-none tracking-[0.18em] max-[380px]:text-[0.58rem] max-[380px]:tracking-[0.15em] sm:text-[0.7rem] sm:tracking-[0.22em]',
								isDark ? 'text-[var(--brand)]' : 'text-sky-600',
							)}
						>
							Проги
						</p>
						<h2
							className={clsx(
								'mt-1.5 text-xl font-black leading-tight tracking-tight max-[380px]:text-lg sm:mt-2 sm:text-2xl md:text-3xl lg:text-3xl lg:leading-[1.1] xl:text-4xl 2xl:text-4xl',
								isDark ? 'text-[var(--fg)]' : 'text-slate-900',
							)}
						>
							{currentStep.mood}
						</h2>
						<p
							className={clsx(
								'mt-2.5 text-sm leading-6 [text-wrap:pretty] max-[380px]:mt-1.5 max-[380px]:text-xs max-[380px]:leading-5 min-[400px]:text-[0.95rem] min-[400px]:leading-[1.55] sm:mt-3 sm:text-base sm:leading-7 md:mt-3.5 md:text-lg md:leading-8 lg:max-w-[48ch] lg:text-lg lg:leading-8 xl:max-w-[46ch] 2xl:text-xl 2xl:leading-9',
								isDark ? 'text-[#c9d1d9]' : 'text-slate-700',
							)}
						>
							{currentStep.message}
						</p>
						{canAdvance && (
							<p
								className={clsx(
									'mt-3 text-[0.6rem] font-semibold uppercase leading-tight tracking-[0.12em] max-[380px]:mt-2.5 sm:mt-3.5 sm:text-[0.65rem] sm:tracking-[0.16em] md:text-xs md:tracking-[0.2em] lg:mt-4',
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
