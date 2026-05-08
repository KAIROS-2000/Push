'use client'

import { RolePill } from '@/components/role-pill'
import { UserLocalTime } from '@/components/user-local-time'
import { useReactHotkeys } from '@/hooks/use-react-hotkeys'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { SupportTicketDetail, SupportTicketMessage } from '@/types'
import { MessageCircle, RefreshCw, Send, X } from 'lucide-react'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from 'react'

const STATUS_LABELS: Record<string, string> = {
	open: 'Новое',
	in_progress: 'В работе',
	resolved: 'Решено',
	closed: 'Закрыто',
}

const CATEGORY_LABELS: Record<string, string> = {
	technical: 'Техника и доступ',
	account: 'Аккаунт и профиль',
	billing: 'Оплата и документы',
	content: 'Уроки и материалы',
	other: 'Другое',
}

function roleLine(senderRole?: string | null): string {
	const r = String(senderRole || '').toLowerCase()
	if (r === 'admin') return 'Админ'
	if (r === 'superadmin') return 'Суперадмин'
	if (r === 'teacher') return 'Учитель'
	if (r === 'student') return 'Ученик'
	if (r === 'parent') return 'Родитель'
	return ''
}

function statusBadgeClass(status: string): string {
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

interface TicketDetailResponse {
	ticket: SupportTicketDetail
	messages: SupportTicketMessage[]
}

export function SupportTicketChatPanel({
	ticketId,
	variant,
	currentUserId,
	onClose,
	onRead,
	onTicketUpdated,
}: {
	ticketId: number
	variant: 'user' | 'staff'
	currentUserId: number
	onClose: () => void
	onRead?: () => void
	onTicketUpdated?: () => void
}) {
	const [ticket, setTicket] = useState<SupportTicketDetail | null>(null)
	const [messages, setMessages] = useState<SupportTicketMessage[]>([])
	const [loading, setLoading] = useState(true)
	const [sending, setSending] = useState(false)
	const [error, setError] = useState('')
	const [draft, setDraft] = useState('')
	const [statusDraft, setStatusDraft] = useState('')
	const [statusSaving, setStatusSaving] = useState(false)
	const mountedRef = useRef(true)
	const draftRef = useRef<HTMLTextAreaElement | null>(null)

	const detailPath =
		variant === 'staff'
			? `/support/staff/tickets/${ticketId}`
			: `/support/tickets/${ticketId}`
	const postMessagePath =
		variant === 'staff'
			? `/support/staff/tickets/${ticketId}/messages`
			: `/support/tickets/${ticketId}/messages`

	const lastMessageId = useMemo(() => messages.at(-1)?.id ?? null, [messages])
	const canSendUser =
		variant === 'user' && ticket?.status !== 'closed' && Boolean(draft.trim()) && !sending
	const canSendStaff = variant === 'staff' && Boolean(draft.trim()) && !sending
	const canSend = canSendUser || canSendStaff

	const markRead = useCallback(async () => {
		try {
			await api(
				`/support/tickets/${ticketId}/read`,
				{
					method: 'POST',
					body: JSON.stringify(lastMessageId ? { last_message_id: lastMessageId } : {}),
				},
				'required',
			)
			onRead?.()
		} catch {
			// non-fatal
		}
	}, [ticketId, lastMessageId, onRead])

	const load = useCallback(async () => {
		setLoading(true)
		setError('')
		try {
			const detail = await api<TicketDetailResponse>(
				`${detailPath}?limit=80`,
				undefined,
				'required',
			)
			if (!mountedRef.current) return
			setTicket(detail.ticket)
			setStatusDraft(detail.ticket.status)
			setMessages(Array.isArray(detail.messages) ? detail.messages : [])
		} catch (e) {
			if (!mountedRef.current) return
			setError(getApiErrorMessage(e, 'Не удалось загрузить обращение.'))
		} finally {
			if (mountedRef.current) setLoading(false)
		}
	}, [detailPath])

	useEffect(() => {
		mountedRef.current = true
		void load()
		return () => {
			mountedRef.current = false
		}
	}, [load])

	useEffect(() => {
		if (!ticketId || !lastMessageId) return
		void markRead()
	}, [ticketId, lastMessageId, markRead])

	const sendDraft = useCallback(async () => {
		const body = draft.trim()
		if (!body || sending) return
		setSending(true)
		setError('')
		try {
			await api(postMessagePath, { method: 'POST', body: JSON.stringify({ body }) }, 'required')
			setDraft('')
			const detail = await api<TicketDetailResponse>(
				`${detailPath}?limit=80`,
				undefined,
				'required',
			)
			if (mountedRef.current) {
				setTicket(detail.ticket)
				setStatusDraft(detail.ticket.status)
				setMessages(Array.isArray(detail.messages) ? detail.messages : [])
			}
			showSuccessToast('Сообщение отправлено.')
			onTicketUpdated?.()
			onRead?.()
		} catch (e) {
			const m = getApiErrorMessage(e, 'Не удалось отправить сообщение.')
			setError(m)
			showErrorToast(m)
		} finally {
			setSending(false)
		}
	}, [draft, sending, postMessagePath, detailPath, onRead, onTicketUpdated])

	const saveStatus = useCallback(async () => {
		if (variant !== 'staff' || !ticket || statusDraft === ticket.status) return
		setStatusSaving(true)
		setError('')
		try {
			await api(
				`/support/staff/tickets/${ticketId}`,
				{ method: 'PATCH', body: JSON.stringify({ status: statusDraft }) },
				'required',
			)
			showSuccessToast('Статус обновлён.')
			await load()
			onTicketUpdated?.()
			onRead?.()
		} catch (e) {
			const m = getApiErrorMessage(e, 'Не удалось сохранить статус.')
			setError(m)
			showErrorToast(m)
		} finally {
			setStatusSaving(false)
		}
	}, [variant, ticket, statusDraft, ticketId, load, onTicketUpdated, onRead])

	const submit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault()
			void sendDraft()
		},
		[sendDraft],
	)

	useReactHotkeys(draftRef, [
		{
			key: 'Enter',
			enabled: canSend,
			preventDefault: e => !e.shiftKey && !e.isComposing,
			handler: e => {
				if (e.shiftKey || e.isComposing) return
				void sendDraft()
			},
		},
	])

	const closedHint =
		variant === 'user' && ticket?.status === 'closed'
			? 'Обращение закрыто. Новый диалог можно начать через форму «Поддержка» в подвале сайта.'
			: null

	return (
		<aside
			className='messaging-panel support-ticket-chat-panel codequest-card p-0'
			data-motion-reveal
		>
			<header className='messaging-panel__header flex shrink-0 flex-wrap items-start justify-between gap-3 p-5 sm:p-6'>
				<div className='min-w-0'>
					<p className='brand-eyebrow'>
						{variant === 'staff' ? 'Поддержка · админ' : 'Поддержка'}
					</p>
					<div className='mt-2 flex flex-wrap items-center gap-2'>
						<h3
							className='line-clamp-2 max-w-full break-words text-xl font-black text-slate-900 sm:text-2xl'
							title={ticket?.subject ?? undefined}
						>
							{ticket?.subject ?? 'Обращение'}
						</h3>
						{ticket ? (
							<span
								className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-black uppercase tracking-wide ring-1 ring-inset ${statusBadgeClass(ticket.status)}`}
							>
								{STATUS_LABELS[ticket.status] ?? ticket.status}
							</span>
						) : null}
					</div>
					<p className='mt-1 text-sm text-slate-500'>
						{ticket ? (
							<>
								{CATEGORY_LABELS[ticket.category] ?? ticket.category}
								{variant === 'staff' && ticket.user ? (
									<>
										{' · '}
										{ticket.user.full_name?.trim() || ticket.user.email}
										{' '}
										<RolePill role={ticket.user.role} />
									</>
								) : null}
							</>
						) : (
							'Загрузка…'
						)}
					</p>
				</div>
				<div className='flex shrink-0 items-center gap-2'>
					<button
						type='button'
						onClick={() => void load()}
						disabled={loading}
						className='messaging-icon-button'
						aria-label='Обновить'
					>
						<RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
					</button>
					<button type='button' onClick={onClose} className='messaging-icon-button' aria-label='Закрыть'>
						<X size={18} />
					</button>
				</div>
			</header>

			{variant === 'staff' && ticket ? (
				<div className='shrink-0 border-b border-slate-200 px-5 py-4 sm:px-6'>
					<div className='flex flex-wrap items-end gap-3'>
						<label className='flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-bold uppercase tracking-wide text-slate-500'>
							Статус для пользователя
							<select
								className='h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900'
								value={statusDraft}
								onChange={e => setStatusDraft(e.target.value)}
								disabled={statusSaving}
							>
								<option value='open'>Новое</option>
								<option value='in_progress'>В работе</option>
								<option value='resolved'>Решено</option>
								<option value='closed'>Закрыто</option>
							</select>
						</label>
						<button
							type='button'
							className='brand-button-primary h-10 px-4'
							disabled={statusSaving || statusDraft === ticket.status}
							onClick={() => void saveStatus()}
						>
							Сохранить статус
						</button>
					</div>
				</div>
			) : null}

			{error ? (
				<div className='shrink-0 px-5 pt-2 sm:px-6'>
					<div className='rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700'>
						{error}
					</div>
				</div>
			) : null}

			<div className='messaging-panel__body flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 sm:px-6 sm:pb-6'>
				<div className='support-ticket-chat-panel__scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain pr-1'>
					{ticket ? (
						<div className='shrink-0 rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4 text-sm text-slate-800'>
							<p className='text-xs font-black uppercase tracking-[0.14em] text-emerald-900'>
								Анкета пользователя
							</p>
							<p className='mt-2 max-h-[min(40vh,22rem)] overflow-y-auto whitespace-pre-wrap break-words leading-relaxed'>
								{ticket.description}
							</p>
							<p className='mt-2 text-xs text-slate-500'>
								Создано{' '}
								<UserLocalTime iso={ticket.created_at} variant='chat' />
							</p>
						</div>
					) : null}

					<div className='messaging-panel__thread support-ticket-chat-panel__thread' data-motion-stagger>
						{loading ? (
							<div className='messaging-panel__empty'>
								<p className='text-sm font-semibold text-slate-500'>Загружаем…</p>
							</div>
						) : messages.length ? (
							messages.map(message => {
								const own = message.is_own === true || message.sender_id === currentUserId
								return (
									<div
										key={message.id}
										className={`messaging-panel__message ${own ? 'messaging-panel__message--own' : 'messaging-panel__message--other'}`}
										data-motion-item
									>
										<div className='messaging-panel__meta'>
											{own ? 'Вы' : message.sender_name || 'Собеседник'}
											{!own && roleLine(message.sender_role) ? (
												<span className='text-slate-400'> · {roleLine(message.sender_role)}</span>
											) : null}
											{' · '}
											<UserLocalTime iso={message.created_at} variant='chat' />
										</div>
										<div className='messaging-panel__bubble whitespace-pre-wrap break-words'>
											{message.body}
										</div>
									</div>
								)
							})
						) : (
							<div className='messaging-panel__empty'>
								<MessageCircle size={30} />
								<p className='mt-3 text-sm text-slate-500'>
									Пока нет переписки по этому обращению
								</p>
							</div>
						)}
					</div>
				</div>

				{closedHint ? (
					<p className='mt-2 shrink-0 text-sm font-semibold text-slate-600'>{closedHint}</p>
				) : null}

				<form
					className='messaging-panel__composer mt-4 flex shrink-0 flex-col gap-3 border-t border-slate-200/90 pt-4 sm:flex-row sm:items-end'
					onSubmit={submit}
				>
					<textarea
						ref={draftRef}
						rows={3}
						className='messaging-panel__input min-h-[4.5rem] flex-1 resize-none'
						placeholder={
							variant === 'staff'
								? 'Ответ пользователю…'
								: 'Уточнение или дополнительная информация…'
						}
						value={draft}
						onChange={e => setDraft(e.target.value)}
						disabled={
							sending || (variant === 'user' && ticket?.status === 'closed') || !ticket
						}
					/>
					<button
						type='submit'
						className='brand-button-primary h-10 gap-2 self-end sm:self-auto'
						disabled={!canSend || !ticket}
					>
						<Send size={16} />
						Отправить
					</button>
				</form>
			</div>
		</aside>
	)
}
