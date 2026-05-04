'use client'

import { AdminAreaShell } from '@/components/admin-area-shell'
import { RolePill } from '@/components/role-pill'
import { StaffDirectThreadPanel } from '@/components/staff-direct-thread-panel'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type {
	StaffDirectUserRef,
	StaffMessagingDirectory,
	StaffMessagingSummaryResponse,
	StaffDirectThreadRow,
} from '@/types'
import { Loader2, Search, Send, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type AdminArea = 'admin' | 'superadmin'

function AdminNewThreadComposer({
	peer,
	onThreadCreated,
}: {
	peer: StaffDirectUserRef
	onThreadCreated: (row: StaffDirectThreadRow) => void
}) {
	const [draft, setDraft] = useState('')
	const [sending, setSending] = useState(false)
	const [error, setError] = useState('')

	const submit = async () => {
		const body = draft.trim()
		if (!body) return
		setSending(true)
		setError('')
		try {
			const res = await api<{
				thread: StaffDirectThreadRow
			}>(
				'/staff-messaging/threads',
				{ method: 'POST', body: JSON.stringify({ peer_id: peer.id, body }) },
				'required',
			)
			if (res.thread) {
				onThreadCreated(res.thread)
				setDraft('')
				showSuccessToast('Сообщение отправлено.')
			}
		} catch (e) {
			const m = getApiErrorMessage(e, 'Не удалось отправить.')
			setError(m)
			showErrorToast(m)
		} finally {
			setSending(false)
		}
	}

	return (
		<aside className='messaging-panel codequest-card p-0' data-motion-reveal>
			<header className='messaging-panel__header p-5 sm:p-6'>
				<div className='min-w-0'>
					<p className='brand-eyebrow'>Новый чат</p>
					<div className='mt-2 flex flex-wrap items-center gap-2'>
						<h3 className='text-2xl font-black text-slate-900'>
							{peer.full_name?.trim() || peer.email}
						</h3>
						<RolePill role={peer.role} />
					</div>
					<p className='mt-1 text-sm text-slate-500'>{peer.email}</p>
				</div>
			</header>
			{error ? (
				<div className='px-5 sm:px-6'>
					<div className='rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700'>
						{error}
					</div>
				</div>
			) : null}
			<div className='messaging-panel__body space-y-4 p-5 sm:p-6'>
				<p className='text-sm text-slate-600'>
					Первое сообщение создаст чат в списке слева.
				</p>
				<textarea
					rows={4}
					className='messaging-panel__input w-full'
					placeholder='Текст сообщения…'
					value={draft}
					onChange={e => setDraft(e.target.value)}
					disabled={sending}
				/>
				<button
					type='button'
					className='brand-button-primary inline-flex h-10 items-center gap-2 px-4'
					disabled={!draft.trim() || sending}
					onClick={() => void submit()}
				>
					<Send size={16} />
					Отправить
				</button>
			</div>
		</aside>
	)
}

function DirectoryList({
	label,
	users,
	selectedId,
	onPick,
	threads,
}: {
	label: string
	users: StaffDirectUserRef[]
	selectedId: number | null
	onPick: (u: StaffDirectUserRef) => void
	threads: StaffDirectThreadRow[]
}) {
	const withThread = useMemo(() => {
		const s = new Set(threads.map(t => t.other.id))
		return s
	}, [threads])

	if (!users.length) {
		return null
	}

	return (
		<div className='space-y-2'>
			<p className='text-xs font-black uppercase tracking-[0.12em] text-slate-500'>{label}</p>
			<div className='space-y-1'>
				{users.map(u => {
					const hasThread = withThread.has(u.id)
					const active = selectedId === u.id
					return (
						<button
							type='button'
							key={u.id}
							onClick={() => onPick(u)}
							className={`flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition ${
								active
									? 'border-slate-900 bg-white shadow-sm'
									: 'border-slate-200 bg-slate-50 hover:border-slate-300'
							}`}
						>
							<span className='min-w-0 truncate'>{u.full_name || u.email}</span>
							<span className='flex shrink-0 items-center gap-1'>
								<RolePill role={u.role} />
								{hasThread ? null : (
									<span className='rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800'>
										нов.
									</span>
								)}
							</span>
						</button>
					)
				})}
			</div>
		</div>
	)
}

export function AdminMessagesPageView({
	area,
	currentUserId,
	initial,
}: {
	area: AdminArea
	currentUserId: number
	initial: StaffMessagingSummaryResponse | null
}) {
	const [data, setData] = useState<StaffMessagingSummaryResponse | null>(initial)
	const [loading, setLoading] = useState(!initial)
	const [error, setError] = useState('')
	const [search, setSearch] = useState('')
	const [searching, setSearching] = useState(false)
	const [searchHits, setSearchHits] = useState<StaffDirectUserRef[]>([])
	const [selectedPeer, setSelectedPeer] = useState<StaffDirectUserRef | null>(null)
	const [activeThread, setActiveThread] = useState<StaffDirectThreadRow | null>(null)
	const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

	const load = useCallback(async () => {
		setError('')
		try {
			const next = await api<StaffMessagingSummaryResponse>('/staff-messaging/summary', undefined, 'required')
			setData(next)
		} catch (e) {
			setError(getApiErrorMessage(e, 'Не удалось загрузить.'))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
		const id = window.setInterval(() => void load(), 25000)
		return () => window.clearInterval(id)
	}, [load])

	const directory = data?.directory ?? (initial?.directory as StaffMessagingDirectory | undefined)
	const dirTeachers = directory?.teachers ?? []
	const dirStaff = directory?.staff ?? []
	const threads = data?.threads ?? initial?.threads ?? []

	useEffect(() => {
		if (searchDebounce.current) {
			clearTimeout(searchDebounce.current)
		}
		const q = search.trim()
		if (q.length < 2) {
			setSearchHits([])
			return
		}
		searchDebounce.current = setTimeout(() => {
			void (async () => {
				setSearching(true)
				try {
					const res = await api<{ users: StaffDirectUserRef[] }>(
						`/staff-messaging/search-users?q=${encodeURIComponent(q)}`,
						undefined,
						'required',
					)
					setSearchHits(res.users ?? [])
				} catch {
					setSearchHits([])
				} finally {
					setSearching(false)
				}
			})()
		}, 300)
		return () => {
			if (searchDebounce.current) clearTimeout(searchDebounce.current)
		}
	}, [search])

	const onPickUser = useCallback(
		(u: StaffDirectUserRef) => {
			setSelectedPeer(u)
			const row = threads.find(t => t.other.id === u.id)
			setActiveThread(row ?? null)
		},
		[threads],
	)

	const onThreadStarted = useCallback(
		(row: StaffDirectThreadRow) => {
			setActiveThread(row)
			void load()
		},
		[load],
	)

	const onPickThread = useCallback(
		(row: StaffDirectThreadRow) => {
			setSelectedPeer(row.other)
			setActiveThread(row)
		},
		[],
	)

	const showComposer = Boolean(selectedPeer && !activeThread)
	const showPanel = Boolean(activeThread && selectedPeer)
	const totalUnread = data?.total_unread ?? 0
	const basePath = area === 'superadmin' ? '/superadmin' : '/admin'

	if (loading && !data) {
		return (
			<AdminAreaShell area={area} section="messages">
				<div className='codequest-card flex min-h-48 items-center justify-center gap-2 p-6 text-slate-600'>
					<Loader2 className='animate-spin' size={20} />
					Загрузка…
				</div>
			</AdminAreaShell>
		)
	}

	return (
		<AdminAreaShell area={area} section="messages">
			<div className='codequest-card p-5 sm:p-6'>
				<div className='flex flex-wrap items-start justify-between gap-3'>
					<div>
						<p className='brand-eyebrow'>Сообщения</p>
						<h1 className='mt-2 text-2xl font-black text-slate-900 sm:text-3xl'>Переписка</h1>
						<p className='mt-1 max-w-2xl text-sm text-slate-600'>
							Список учителей и роли администрации, а также поиск по email. Первое сообщение пользователю
							добавляет чат в список переписок.
						</p>
					</div>
					<span className='brand-chip brand-chip--soft'>{totalUnread} непрочитанных</span>
				</div>
			</div>

			{error ? (
				<div className='rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700'>
					{error}
				</div>
			) : null}

			<div className='admin-messages__layout grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]'>
				<aside className='codequest-card p-4 sm:p-5'>
					<div className='relative mb-4'>
						<Search
							className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'
							size={16}
						/>
						<input
							type='search'
							className='h-10 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm'
							placeholder='Поиск по email (от 2 симв.)'
							value={search}
							onChange={e => setSearch(e.target.value)}
						/>
						{searching ? (
							<Loader2
								className='absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400'
								size={16}
							/>
						) : null}
					</div>

					{search.trim().length >= 2 ? (
						<div className='mb-4 space-y-1'>
							<p className='text-xs font-black uppercase tracking-[0.12em] text-slate-500'>Найдено</p>
							{searchHits.length ? (
								searchHits.map(u => {
									const active = selectedPeer?.id === u.id
									return (
										<button
											type='button'
											key={u.id}
											className={`flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm ${
												active
													? 'border-slate-900 bg-white shadow-sm'
													: 'border-slate-200 bg-slate-50'
											}`}
											onClick={() => onPickUser(u)}
										>
											<span className='min-w-0'>
												<span className='block font-semibold text-slate-900'>{u.email}</span>
												<span className='text-xs text-slate-500'>{u.full_name}</span>
											</span>
											<RolePill role={u.role} />
										</button>
									)
								})
							) : (
								<p className='text-sm text-slate-500'>{searching ? '…' : 'Никого не найдено.'}</p>
							)}
						</div>
					) : null}

					<div className='max-h-[40vh] space-y-5 overflow-y-auto pr-1 lg:max-h-[65vh]'>
						<DirectoryList
							label='Учителя'
							users={dirTeachers}
							selectedId={selectedPeer?.id ?? null}
							onPick={onPickUser}
							threads={threads}
						/>
						<DirectoryList
							label='Администрация'
							users={dirStaff}
							selectedId={selectedPeer?.id ?? null}
							onPick={onPickUser}
							threads={threads}
						/>
						{threads.length ? (
							<div>
								<p className='mb-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500'>
									Переписки
								</p>
								<div className='space-y-1'>
									{threads.map(row => {
										const active = activeThread?.thread_id === row.thread_id
										return (
											<button
												type='button'
												key={row.thread_id}
												className={`w-full rounded-2xl border px-3 py-2.5 text-left ${
													active
														? 'border-slate-900 bg-white shadow-sm'
														: 'border-slate-200 bg-slate-50 hover:border-slate-300'
												}`}
												onClick={() => onPickThread(row)}
											>
												<div className='flex items-start justify-between gap-2'>
													<div className='min-w-0'>
														<p className='font-semibold text-slate-900'>{row.other.full_name || row.other.email}</p>
														<p className='text-xs text-slate-500'>{row.other.email}</p>
													</div>
													{row.unread_count > 0 ? (
														<span className='messaging-unread-badge'>{row.unread_count}</span>
													) : null}
												</div>
												{row.latest_message_preview ? (
													<p className='mt-1 line-clamp-2 text-xs text-slate-500'>{row.latest_message_preview}</p>
												) : null}
											</button>
										)
									})}
								</div>
							</div>
						) : null}
					</div>
				</aside>

				<div className='admin-messages__chat-col min-w-0'>
					{showPanel && activeThread ? (
						<StaffDirectThreadPanel
							threadId={activeThread.thread_id}
							peer={activeThread.other}
							currentUserId={currentUserId}
							onRead={() => void load()}
							onClose={() => {
								setActiveThread(null)
								setSelectedPeer(null)
							}}
						/>
					) : null}
					{showComposer && selectedPeer ? (
						<AdminNewThreadComposer
							peer={selectedPeer}
							onThreadCreated={onThreadStarted}
						/>
					) : null}
					{!showPanel && !showComposer ? (
						<article className='messaging-panel codequest-card p-0'>
							<header className='messaging-panel__header p-5 sm:p-6'>
								<Users size={24} className='text-slate-400' />
								<h2 className='mt-2 text-2xl font-black text-slate-900'>Выберите адресата</h2>
								<p className='mt-1 text-sm text-slate-500'>
									Слева — каталог, поиск по email и переписки. Ученики и преподаватели в обычном
									разделе «Сообщения» этого поиска не используют.
								</p>
								<a
									href={`${basePath}/users`}
									className='mt-3 inline-block text-sm font-semibold text-slate-700 underline'
								>
									Перейти к пользователям
								</a>
							</header>
						</article>
					) : null}
				</div>
			</div>
		</AdminAreaShell>
	)
}
