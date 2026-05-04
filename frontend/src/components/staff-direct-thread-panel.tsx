'use client'

import { UserLocalTime } from '@/components/user-local-time'
import { useReactHotkeys } from '@/hooks/use-react-hotkeys'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { StaffDirectUserRef, StaffDirectThreadRow } from '@/types'
import { MessageCircle, RefreshCw, Send, X } from 'lucide-react'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from 'react'
import { RolePill } from './role-pill'

interface StaffThreadMessagesResponse {
	thread?: StaffDirectThreadRow
	messages: Array<{
		id: number
		sender_id: number
		sender_name?: string | null
		sender_role?: string | null
		body: string
		created_at: string
		is_own?: boolean
	}>
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

export function StaffDirectThreadPanel({
	threadId,
	peer,
	currentUserId,
	onClose,
	onRead,
}: {
	threadId: number
	peer: StaffDirectUserRef
	currentUserId: number
	onClose: () => void
	onRead?: () => void
}) {
	const [messages, setMessages] = useState<StaffThreadMessagesResponse['messages']>([])
	const [loading, setLoading] = useState(true)
	const [sending, setSending] = useState(false)
	const [error, setError] = useState('')
	const [draft, setDraft] = useState('')
	const mountedRef = useRef(true)
	const draftRef = useRef<HTMLTextAreaElement | null>(null)
	const lastMessageId = useMemo(() => messages.at(-1)?.id ?? null, [messages])

	const title = peer.full_name?.trim() || peer.email
	const canSend = Boolean(draft.trim()) && !sending

	const markRead = useCallback(async () => {
		if (!threadId) return
		try {
			await api(
				`/staff-messaging/threads/${threadId}/read`,
				{
					method: 'POST',
					body: JSON.stringify(
						lastMessageId ? { last_message_id: lastMessageId } : {},
					),
				},
				'required',
			)
			onRead?.()
		} catch {
			// non-fatal
		}
	}, [threadId, lastMessageId, onRead])

	const load = useCallback(async () => {
		if (!threadId) return
		setLoading(true)
		setError('')
		try {
			const detail = await api<StaffThreadMessagesResponse>(
				`/staff-messaging/threads/${threadId}/messages?limit=80`,
				undefined,
				'required',
			)
			if (!mountedRef.current) return
			setMessages(Array.isArray(detail.messages) ? detail.messages : [])
		} catch (e) {
			if (!mountedRef.current) return
			setError(getApiErrorMessage(e, 'Не удалось загрузить чат.'))
		} finally {
			if (mountedRef.current) setLoading(false)
		}
	}, [threadId])

	useEffect(() => {
		mountedRef.current = true
		void load()
		return () => {
			mountedRef.current = false
		}
	}, [load])

	useEffect(() => {
		if (!threadId || !lastMessageId) return
		void markRead()
	}, [threadId, lastMessageId, markRead])

	const sendDraft = useCallback(async () => {
		const body = draft.trim()
		if (!body || !threadId || sending) return
		setSending(true)
		setError('')
		try {
			await api(
				`/staff-messaging/threads/${threadId}/messages`,
				{ method: 'POST', body: JSON.stringify({ body }) },
				'required',
			)
			setDraft('')
			const detail = await api<StaffThreadMessagesResponse>(
				`/staff-messaging/threads/${threadId}/messages?limit=80`,
				undefined,
				'required',
			)
			if (mountedRef.current) {
				setMessages(Array.isArray(detail.messages) ? detail.messages : [])
			}
			showSuccessToast('Сообщение отправлено.')
		} catch (e) {
			const m = getApiErrorMessage(e, 'Не удалось отправить сообщение.')
			setError(m)
			showErrorToast(m)
		} finally {
			setSending(false)
		}
	}, [draft, threadId, sending])

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

	return (
		<aside className='messaging-panel codequest-card p-0' data-motion-reveal>
			<header className='messaging-panel__header flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6'>
				<div className='min-w-0'>
					<p className='brand-eyebrow'>Сообщения</p>
					<div className='mt-2 flex flex-wrap items-center gap-2'>
						<h3 className='break-words text-2xl font-black text-slate-900'>{title}</h3>
						<RolePill role={peer.role} />
					</div>
					<p className='mt-1 text-sm text-slate-500'>
						{peer.email} · переписка с администрацией
					</p>
				</div>
				<div className='flex items-center gap-2'>
					<button
						type='button'
						onClick={() => void load()}
						disabled={loading}
						className='messaging-icon-button'
						aria-label='Обновить чат'
					>
						<RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
					</button>
					<button
						type='button'
						onClick={onClose}
						className='messaging-icon-button'
						aria-label='Закрыть чат'
					>
						<X size={18} />
					</button>
				</div>
			</header>

			{error ? (
				<div className='shrink-0 px-5 pb-0 sm:px-6'>
					<div className='rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700'>
						{error}
					</div>
				</div>
			) : null}

			<div className='messaging-panel__body px-5 pb-5 sm:px-6 sm:pb-6'>
				<div className='messaging-panel__thread' data-motion-stagger>
					{loading ? (
						<div className='messaging-panel__empty'>
							<p className='text-sm font-semibold text-slate-500'>Загружаем…</p>
						</div>
					) : messages.length ? (
						messages.map(message => {
							const own =
								message.is_own === true || message.sender_id === currentUserId
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
										<UserLocalTime
											iso={message.created_at}
											variant='chat'
										/>
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
							<p className='mt-3 text-sm text-slate-500'>Сообщений пока нет</p>
						</div>
					)}
				</div>

				<form
					className='messaging-panel__composer mt-4 flex flex-col gap-3 sm:flex-row sm:items-end'
					onSubmit={submit}
				>
					<textarea
						ref={draftRef}
						rows={3}
						className='messaging-panel__input min-h-[4.5rem] flex-1 resize-none'
						placeholder='Напишите ответ…'
						value={draft}
						onChange={e => setDraft(e.target.value)}
					/>
					<button
						type='submit'
						className='brand-button-primary h-10 gap-2 self-end sm:self-auto'
						disabled={!canSend}
					>
						<Send size={16} />
						Отправить
					</button>
				</form>
			</div>
		</aside>
	)
}
