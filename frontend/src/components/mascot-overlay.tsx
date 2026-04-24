'use client'

import {
	MASCOT_QUEUE_EVENT,
	MascotScenario,
	popMascotScenario,
} from '@/lib/mascot'
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
			className='fixed inset-0 z-[100] flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-slate-950/70 backdrop-blur-sm'
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
			<div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.28),_rgba(15,23,42,0.94)_56%)]' />

			<div className='relative flex h-full max-h-[100dvh] w-full flex-col gap-4 overflow-hidden px-4 py-4 sm:gap-6 sm:px-6 sm:py-6 lg:grid lg:grid-cols-[minmax(320px,460px)_minmax(0,1fr)] lg:gap-8 lg:px-12 lg:py-10'>
				<div className='flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[32px] border border-white/15 bg-white/10 p-3 shadow-2xl shadow-slate-950/30 backdrop-blur-md sm:p-5 lg:flex-none lg:h-full lg:p-8'>
					<div className='flex h-full max-h-full w-full items-center justify-center overflow-hidden rounded-[28px] border border-white/50 bg-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.18)]'>
						<img
							key={currentStep.image}
							src={spriteUrl(currentStep.image)}
							alt={currentStep.mood}
							className='block h-auto max-h-full w-auto max-w-full rounded-[28px] object-contain'
						/>
					</div>
				</div>

				<div className='flex min-h-0 shrink-0 items-center overflow-hidden lg:h-full'>
					<div className='w-full max-h-full overflow-y-auto rounded-[36px] border border-white/15 bg-white/92 p-5 shadow-2xl shadow-slate-950/25 backdrop-blur-xl sm:p-8 lg:p-12'>
						<p className='text-xs font-bold uppercase tracking-[0.28em] text-sky-600'>
							Проги
						</p>
						<h2 className='mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-4xl lg:text-5xl'>
							{currentStep.mood}
						</h2>
						<p className='mt-4 max-w-3xl text-base leading-7 text-slate-700 sm:mt-6 sm:text-xl sm:leading-9 lg:text-2xl lg:leading-10'>
							{currentStep.message}
						</p>
						{canAdvance && (
							<p className='mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 sm:mt-8 sm:text-sm'>
								Нажми в любое место экрана
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
