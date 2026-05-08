'use client'

import { AdminAreaShell } from '@/components/admin-area-shell'
import { RolePill } from '@/components/role-pill'
import { SupportTicketChatPanel } from '@/components/support-ticket-chat-panel'
import { UserLocalTime } from '@/components/user-local-time'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast } from '@/lib/toast'
import type { SupportStaffTicketRow } from '@/types'
import { Headphones, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type AdminArea = 'admin' | 'superadmin'

const FILTERS: Array<{ value: string; label: string }> = [
	{ value: 'all', label: 'Все' },
	{ value: 'open', label: 'Новые' },
	{ value: 'in_progress', label: 'В работе' },
	{ value: 'resolved', label: 'Решённые' },
	{ value: 'closed', label: 'Закрытые' },
]

function statusChip(status: string): string {
	switch (status) {
		case 'open':
			return 'bg-amber-100 text-amber-900 ring-amber-200'
		case 'in_progress':
			return 'bg-sky-100 text-sky-900 ring-sky-200'
		case 'resolved':
			return 'bg-emerald-100 text-emerald-900 ring-emerald-200'
		case 'closed':
			return 'bg-slate-200 text-slate-700 ring-slate-300'
		default:
			return 'bg-slate-100 text-slate-800 ring-slate-200'
	}
}

export function AdminSupportPageView({
	area,
	currentUserId,
}: {
	area: AdminArea
	currentUserId: number
}) {
	const [filter, setFilter] = useState('all')
	const [rows, setRows] = useState<SupportStaffTicketRow[]>([])
	const [totalUnread, setTotalUnread] = useState(0)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [activeId, setActiveId] = useState<number | null>(null)

	const load = useCallback(async () => {
		setError('')
		try {
			const res = await api<{ tickets: SupportStaffTicketRow[]; total_unread: number }>(
				`/support/staff/tickets?status=${encodeURIComponent(filter)}`,
				undefined,
				'required',
			)
			setRows(Array.isArray(res.tickets) ? res.tickets : [])
			setTotalUnread(res.total_unread ?? 0)
		} catch (e) {
			setError(getApiErrorMessage(e, 'Не удалось загрузить обращения.'))
			showErrorToast(getApiErrorMessage(e, 'Не удалось загрузить обращения.'))
		} finally {
			setLoading(false)
		}
	}, [filter])

	useEffect(() => {
		void load()
		const id = window.setInterval(() => void load(), 25000)
		return () => window.clearInterval(id)
	}, [load])

	return (
		<AdminAreaShell area={area} section='support'>
			<div className='codequest-card p-5 sm:p-6'>
				<div className='flex flex-wrap items-start justify-between gap-3'>
					<div>
						<p className='brand-eyebrow'>Поддержка</p>
						<h1 className='mt-2 text-2xl font-black text-slate-900 sm:text-3xl'>Обращения пользователей</h1>
						<p className='mt-1 max-w-2xl text-sm text-slate-600'>
							Заявки из анкеты на сайте. Статус видят пользователи в разделе «Сообщения». Ответы
							прикрепляются к тикету; сверху чата для всех отображается текст анкеты.
						</p>
					</div>
					<span className='brand-chip brand-chip--soft inline-flex items-center gap-2'>
						<Headphones size={16} aria-hidden />
						{totalUnread} непрочитанных
					</span>
				</div>

				<div className='mt-6 flex flex-wrap gap-2'>
					{FILTERS.map(f => (
						<button
							key={f.value}
							type='button'
							onClick={() => {
								setFilter(f.value)
								setLoading(true)
							}}
							className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wide ring-1 ring-inset transition ${
								filter === f.value
									? 'bg-slate-900 text-white ring-slate-900'
									: 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-white'
							}`}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>

			{error ? (
				<div className='rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700'>
					{error}
				</div>
			) : null}

			<div className='admin-messages__layout grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]'>
				<aside className='codequest-card max-h-[72vh] overflow-y-auto p-4 sm:p-5'>
					{loading && !rows.length ? (
						<div className='flex items-center gap-2 text-slate-500'>
							<Loader2 className='animate-spin' size={18} />
							Загрузка…
						</div>
					) : rows.length ? (
						<ul className='space-y-2'>
							{rows.map(row => {
								const active = activeId === row.ticket_id
								return (
									<li key={row.ticket_id}>
										<button
											type='button'
											onClick={() => setActiveId(row.ticket_id)}
											className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
												active
													? 'border-slate-900 bg-white shadow-sm'
													: 'border-slate-200 bg-slate-50 hover:border-slate-300'
											}`}
										>
											<div className='flex items-start justify-between gap-2'>
												<p className='min-w-0 flex-1 font-semibold text-slate-900 line-clamp-2'>
													{row.subject}
												</p>
												{row.unread_count > 0 ? (
													<span className='messaging-unread-badge shrink-0'>{row.unread_count}</span>
												) : null}
											</div>
											<div className='mt-2 flex flex-wrap items-center gap-2'>
												<span
													className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ring-1 ring-inset ${statusChip(row.status)}`}
												>
													{row.status === 'open'
														? 'Новое'
														: row.status === 'in_progress'
															? 'В работе'
															: row.status === 'resolved'
																? 'Решено'
																: row.status === 'closed'
																	? 'Закрыто'
																	: row.status}
												</span>
												{row.user ? <RolePill role={row.user.role} /> : null}
											</div>
											<p className='mt-1 truncate text-xs text-slate-500'>
												{row.user?.full_name?.trim() || row.user?.email || 'Пользователь'}
											</p>
											{row.latest_message_preview ? (
												<p className='mt-1 line-clamp-2 text-xs text-slate-500'>
													{row.latest_message_preview}
												</p>
											) : null}
											<p className='mt-2 text-[11px] font-semibold text-slate-400'>
												Обновлено <UserLocalTime iso={row.updated_at} variant='admin' />
											</p>
										</button>
									</li>
								)
							})}
						</ul>
					) : (
						<p className='text-sm text-slate-500'>Нет обращений в этом фильтре.</p>
					)}
				</aside>

				<div className='admin-messages__chat-col min-h-0 min-w-0'>
					{activeId ? (
						<SupportTicketChatPanel
							key={activeId}
							ticketId={activeId}
							variant='staff'
							currentUserId={currentUserId}
							onClose={() => setActiveId(null)}
							onRead={() => void load()}
							onTicketUpdated={() => void load()}
						/>
					) : (
						<article className='messaging-panel codequest-card p-0'>
							<header className='messaging-panel__header p-5 sm:p-6'>
								<Headphones className='text-slate-400' size={28} />
								<h2 className='mt-2 text-2xl font-black text-slate-900'>Выберите обращение</h2>
								<p className='mt-1 text-sm text-slate-500'>
									Слева список тикетов с фильтром по статусу. В чате можно менять статус и отвечать
									пользователю.
								</p>
							</header>
						</article>
					)}
				</div>
			</div>
		</AdminAreaShell>
	)
}
