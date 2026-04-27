import type { LucideIcon } from 'lucide-react'

type StatCardTone = 'sky' | 'emerald' | 'violet' | 'amber'

interface StatCardProps {
	value: string
	label: string
	detail?: string
	icon: LucideIcon
	tone?: StatCardTone
	kicker?: string
	progress?: number
}

function normalizeProgress(progress?: number) {
	if (progress === undefined) return null
	return Math.max(0, Math.min(100, Math.round(progress)))
}

export function StatCard({
	value,
	label,
	detail,
	icon: Icon,
	tone = 'sky',
	kicker = 'metric',
	progress,
}: StatCardProps) {
	const normalizedProgress = normalizeProgress(progress)

	return (
		<article
			className={`brand-stat-card student-metric student-metric--${tone} codequest-card p-3 xl:p-4`}
			data-kicker={kicker}
			data-motion-item
			data-motion-hover
		>
			<div className='student-metric__topline'>
				<span className='student-metric__kicker'>{kicker}</span>
				<span className='student-metric__icon-wrap' aria-hidden='true'>
					<Icon className='student-metric__icon' strokeWidth={2.25} />
				</span>
			</div>

			<p className='student-metric__value'>{value}</p>
			<p className='student-metric__label'>{label}</p>
			{detail && <p className='student-metric__detail'>{detail}</p>}

			{normalizedProgress !== null && (
				<div
					className='student-metric__meter'
					role='progressbar'
					aria-label={`Индикатор: ${label}`}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={normalizedProgress}
				>
					<span style={{ width: `${normalizedProgress}%` }} />
				</div>
			)}
		</article>
	)
}
