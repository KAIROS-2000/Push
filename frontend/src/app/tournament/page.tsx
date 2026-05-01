import type { Metadata } from 'next'
import Link from 'next/link'
import {
	AlertTriangle,
	CalendarDays,
	ExternalLink,
	RefreshCw,
	Trophy,
} from 'lucide-react'

import { SiteFooter } from '@/components/site-footer'
import { UserLocalTime } from '@/components/user-local-time'
import { getTournamentData, type TournamentOfficeRow } from '@/lib/tournament-data'

export const metadata: Metadata = {
	title: 'Турнир между офисами | Progyx',
	description: 'Публичная таблица турнира между офисами Progyx.',
}

function formatScore(value: number | null) {
	return value === null ? '—' : new Intl.NumberFormat('ru-RU').format(value)
}

function formatPercent(value: number | null) {
	if (value === null) return '—'
	return `${new Intl.NumberFormat('ru-RU', {
		maximumFractionDigits: 3,
	}).format(value)}%`
}

function filledWeeksCount(rows: TournamentOfficeRow[]) {
	return Math.max(
		0,
		...rows.map(row => row.weekScores.filter(value => value !== null).length),
	)
}

function officeToneClass(rank: number) {
	if (rank === 1) return 'tournament-office-card--leader'
	if (rank === 2) return 'tournament-office-card--second'
	if (rank === 3) return 'tournament-office-card--third'
	return 'tournament-office-card--base'
}

export default async function TournamentPage() {
	const data = await getTournamentData()
	const rows = [...data.rows].sort((a, b) => a.rank - b.rank)
	const leader = rows[0] ?? null
	const maxTotal = Math.max(1, ...rows.map(row => row.total))
	const weeksCount = filledWeeksCount(rows)

	return (
		<main className='brand-public-shell tournament-page'>
			<section className='brand-page-shell tournament-hero'>
				<div className='tournament-hero__copy'>
					<p className='brand-eyebrow'>Public tournament</p>
					<h1 className='brand-display tournament-hero__title'>
						Турнир между офисами
					</h1>
					<p className='brand-lead tournament-hero__lead'>
						Общий экран результатов: баллы по неделям, отзывы,
						посещаемость и итоговая гонка офисов в одном месте.
					</p>

					<div className='tournament-hero__meta'>
						<span className='brand-chip brand-chip--warm'>
							<RefreshCw aria-hidden size={16} />
							Обновлено:{' '}
							{data.meta.modified ? (
								<UserLocalTime
									iso={data.meta.modified}
									variant='tournament'
									emptyLabel='нет данных'
									invalidLabel='нет данных'
								/>
							) : (
								'нет данных'
							)}
						</span>
						<span className='brand-chip brand-chip--soft'>
							<CalendarDays aria-hidden size={16} />
							Заполнено недель: {weeksCount}
						</span>
						<Link
							href={data.meta.sourceUrl}
							target='_blank'
							rel='noreferrer'
							className='brand-chip tournament-source-link'
						>
							<ExternalLink aria-hidden size={16} />
							Источник
						</Link>
					</div>
				</div>

				<aside className='tournament-leader-card' aria-label='Лидер турнира'>
					<div className='tournament-leader-card__icon'>
						<Trophy aria-hidden size={34} />
					</div>
					<p className='tournament-leader-card__eyebrow'>Лидер сейчас</p>
					<h2>{leader?.office ?? 'Нет данных'}</h2>
					<div className='tournament-leader-card__score'>
						<span>{formatScore(leader?.total ?? null)}</span>
						баллов
					</div>
					<div className='tournament-leader-card__bar' aria-hidden>
						<span style={{ width: leader ? `${(leader.total / maxTotal) * 100}%` : '0%' }} />
					</div>
				</aside>
			</section>

			{data.sourceWarning && (
				<section className='brand-page-shell'>
					<div className='tournament-source-warning'>
						<AlertTriangle aria-hidden size={20} />
						<p>{data.sourceWarning}</p>
					</div>
				</section>
			)}

			<section className='brand-page-shell tournament-grid-section'>
				<div className='tournament-section-heading'>
					<p className='brand-eyebrow'>Standings</p>
					<h2>Текущая таблица</h2>
				</div>

				<div className='tournament-office-grid'>
					{rows.map(row => (
						<article
							key={row.id}
							className={`tournament-office-card ${officeToneClass(row.rank)}`}
						>
							<div className='tournament-office-card__top'>
								<span className='tournament-rank'>#{row.rank}</span>
								<span className='tournament-office-card__percent'>
									{formatPercent(row.attendancePercent)}
								</span>
							</div>
							<h3>{row.office}</h3>
							<div className='tournament-office-card__score'>
								{formatScore(row.total)}
								<span>итого</span>
							</div>
							<div className='tournament-office-card__bar' aria-hidden>
								<span style={{ width: `${(row.total / maxTotal) * 100}%` }} />
							</div>
							<div className='tournament-office-card__details'>
								<span>Посещаемость: {formatScore(row.attendanceScore)}</span>
								<span>Отзывы: {formatScore(row.reviewScore)}</span>
							</div>
						</article>
					))}
				</div>
			</section>

			<section className='brand-page-shell tournament-table-section'>
				<div className='tournament-table-card'>
					<div className='tournament-table-card__header'>
						<div>
							<p className='brand-eyebrow'>Weeks</p>
							<h2>Детализация баллов</h2>
						</div>
						<p>
							{data.meta.fileName}
							{data.meta.revision ? ` · rev ${data.meta.revision}` : ''}
						</p>
					</div>

					<div className='tournament-table-wrap'>
						<table className='tournament-table'>
							<thead>
								<tr>
									<th>Место</th>
									<th>Офис</th>
									{data.weekLabels.map(label => (
										<th key={label}>{label}</th>
									))}
									<th>Посещаемость</th>
									<th>Отзывы</th>
									<th>Итого</th>
									<th>%</th>
								</tr>
							</thead>
							<tbody>
								{rows.map(row => (
									<tr key={row.id}>
										<td>#{row.rank}</td>
										<td>{row.office}</td>
										{data.weekLabels.map((label, index) => (
											<td key={`${row.id}-${label}`}>
												{formatScore(row.weekScores[index] ?? null)}
											</td>
										))}
										<td>{formatScore(row.attendanceScore)}</td>
										<td>{formatScore(row.reviewScore)}</td>
										<td>{formatScore(row.total)}</td>
										<td>{formatPercent(row.attendancePercent)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</section>

			<section className='brand-page-shell tournament-details'>
				<article className='tournament-rules-card'>
					<p className='brand-eyebrow'>Rules</p>
					<h2>Как считаются баллы</h2>
					<ul>
						{data.rules.map(rule => (
							<li key={rule}>{rule}</li>
						))}
					</ul>
				</article>
			</section>

			<section className='brand-page-shell tournament-jury'>
				<p className='brand-eyebrow'>Jury</p>
				<div>
					{data.jury.map(member => (
						<span key={member}>{member}</span>
					))}
				</div>
			</section>

			<SiteFooter showRegisterLink={false} />
		</main>
	)
}
