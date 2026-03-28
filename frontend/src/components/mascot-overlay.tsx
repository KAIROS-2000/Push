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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api'
const STEP_DELAY_MS = 5000

const SCENARIOS: Record<MascotScenario, MascotStep[]> = {
	post_register_intro: [
		{
			image: 'Взволнованный.png',
			mood: 'Коди',
			message:
				'Привет! Меня зовут Коди. Я живу на этом сайте и мне срочно нужна твоя помощь!!!',
		},
		{
			image: 'Нейтральный.png',
			mood: 'Коди',
			message: 'Мне не хватает XP, которые нужны мне для зарядки магии',
		},
		{
			image: 'Радостный 1.png',
			mood: 'Коди',
			message:
				'Скорее переходи в раздел с уроками, зарабатывай XP и помоги мне одолеть зло!',
		},
	],
	first_lesson_complete: [
		{
			image: 'Радостный 2.png',
			mood: 'Коди',
			message:
				'Это было потрясающе! Большое тебе спасибо, буду рад видеть тебя снова!',
		},
	],
}

function spriteUrl(filename: string) {
	return `${API_URL}/mascot/${encodeURIComponent(filename)}`
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
			className='fixed inset-0 z-[100] overflow-y-auto bg-slate-950/70 backdrop-blur-sm'
			onClick={handleAdvance}
			onKeyDown={event => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault()
					handleAdvance()
				}
			}}
			role='button'
			tabIndex={0}
			aria-label='Диалог с Коди'
		>
			<div className='grid h-full w-full gap-6 bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.28),_rgba(15,23,42,0.94)_56%)] px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(320px,460px)_minmax(0,1fr)] lg:items-center lg:px-14 lg:py-12'>
				<div className='flex min-h-[38vh] items-end justify-center overflow-hidden rounded-[32px] border border-white/15 bg-white/10 p-5 shadow-2xl shadow-slate-950/30 backdrop-blur-md lg:min-h-[78vh] lg:p-8'>
					<div className='w-full overflow-hidden rounded-[28px] border border-white/50 bg-white/80 shadow-[0_20px_60px_rgba(15,23,42,0.18)]'>
						<img
							key={currentStep.image}
							src={spriteUrl(currentStep.image)}
							alt={currentStep.mood}
							className='mx-auto h-auto max-h-[72vh] w-full rounded-[28px] object-contain'
						/>
					</div>
				</div>

				<div className='flex items-center'>
					<div className='w-full rounded-[36px] border border-white/15 bg-white/92 p-7 shadow-2xl shadow-slate-950/25 backdrop-blur-xl sm:p-10 lg:min-h-[56vh] lg:p-14'>
						<p className='text-xs font-bold uppercase tracking-[0.28em] text-sky-600'>
							Коди
						</p>
						<h2 className='mt-4 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl lg:text-6xl'>
							{currentStep.mood}
						</h2>
						<p className='mt-6 max-w-3xl text-xl leading-9 text-slate-700 sm:text-2xl sm:leading-10'>
							{currentStep.message}
						</p>
						{canAdvance && (
							<p className='mt-10 text-sm font-semibold uppercase tracking-[0.22em] text-slate-400'>
								Нажми в любое место экрана
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
