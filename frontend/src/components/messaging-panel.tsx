'use client'

import { useReactHotkeys } from '@/hooks/use-react-hotkeys'
import { api } from '@/lib/api'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import {
	MessagingChatTarget,
	MessagingConversationDetailResponse,
	MessagingConversationSummary,
	MessagingMessage,
} from '@/types'
import { Inbox, Loader2, RefreshCw, Send, X } from 'lucide-react'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from 'react'

interface MessagingPanelProps {
	role: 'student' | 'teacher'
	target: MessagingChatTarget
	currentUserId?: number
	onClose: () => void
	onConversationRead?: (conversationId: number | null) => void
}

function normalizeConversationId(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractConversationId(payload: unknown): number | null {
	if (!isRecord(payload)) return null

	const direct = normalizeConversationId(
		payload.conversation_id ?? payload.id ?? payload.conversationId,
	)
	if (direct) return direct

	const conversation = payload.conversation
	if (isRecord(conversation)) {
		return normalizeConversationId(
			conversation.conversation_id ?? conversation.id ?? conversation.conversationId,
		)
	}

	return null
}

function normalizeConversation(
	payload: MessagingConversationDetailResponse | MessagingConversationSummary | null,
	fallback: MessagingChatTarget,
): MessagingConversationSummary {
	const source: Partial<MessagingConversationSummary> | undefined =
		payload && 'messages' in payload ? payload.conversation : (payload ?? undefined)

	return {
		conversation_id:
			normalizeConversationId(source?.conversation_id) ??
			normalizeConversationId(source?.id) ??
			fallback.conversationId ??
			null,
		classroom_id: source?.classroom_id ?? fallback.classroomId,
		classroom_name: source?.classroom_name ?? fallback.classroomName,
		teacher_id: source?.teacher_id ?? fallback.teacherId ?? null,
		teacher_name: source?.teacher_name ?? fallback.teacherName ?? 'Учитель',
		student_id: source?.student_id ?? fallback.studentId ?? null,
		student_name: source?.student_name ?? fallback.studentName ?? 'Ученик',
		latest_message_at: source?.latest_message_at ?? null,
		latest_message_preview: source?.latest_message_preview ?? null,
		unread_count: source?.unread_count ?? 0,
	}
}

function normalizeMessages(payload: MessagingConversationDetailResponse): MessagingMessage[] {
	if (Array.isArray(payload.messages)) return payload.messages
	return []
}

function formatChatTime(value?: string | null) {
	if (!value) return ''
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleString('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function isOwnMessage(
	message: MessagingMessage,
	role: 'student' | 'teacher',
	currentUserId?: number,
) {
	if (typeof currentUserId === 'number' && message.sender_id === currentUserId) {
		return true
	}
	if (message.sender_role) return message.sender_role === role
	return false
}

export function MessagingPanel({
	role,
	target,
	currentUserId,
	onClose,
	onConversationRead,
}: MessagingPanelProps) {
	const [conversation, setConversation] =
		useState<MessagingConversationSummary>(() => normalizeConversation(null, target))
	const [messages, setMessages] = useState<MessagingMessage[]>([])
	const [draft, setDraft] = useState('')
	const [loading, setLoading] = useState(false)
	const [sending, setSending] = useState(false)
	const [error, setError] = useState('')
	const mountedRef = useRef(true)
	const draftRef = useRef<HTMLTextAreaElement | null>(null)

	const title = role === 'teacher' ? target.studentName || 'Ученик' : target.teacherName || 'Учитель'
	const subtitle = `${target.classroomName} · ${role === 'teacher' ? 'чат с учеником' : 'чат с учителем'}`
	const lastMessageId = useMemo(() => messages.at(-1)?.id ?? null, [messages])
	const canUseComposer = !loading && !sending && Boolean(conversation.conversation_id)
	const canSend = canUseComposer && Boolean(draft.trim())

	const loadConversation = useCallback(async () => {
		setLoading(true)
		setError('')
		try {
			const createBody: Record<string, number> = {
				classroom_id: target.classroomId,
			}
			if (role === 'teacher' && target.studentId) {
				createBody.student_id = target.studentId
			}

			const created = await api<MessagingConversationSummary | { conversation: MessagingConversationSummary }>(
				'/messaging/conversations',
				{ method: 'POST', body: JSON.stringify(createBody) },
				'required',
			)
			const conversationId = extractConversationId(created)
			if (!conversationId) {
				throw new Error('Сервер не вернул идентификатор беседы.')
			}

			const detail = await api<MessagingConversationDetailResponse>(
				`/messaging/conversations/${conversationId}/messages?limit=80`,
				undefined,
				'required',
			)
			if (!mountedRef.current) return
			const normalized = normalizeConversation(detail, {
				...target,
				conversationId,
			})
			setConversation(normalized)
			setMessages(normalizeMessages(detail))
		} catch (loadError) {
			if (!mountedRef.current) return
			const message =
				loadError instanceof Error
					? loadError.message
					: 'Не удалось открыть чат.'
			setError(message)
			showErrorToast(message)
		} finally {
			if (mountedRef.current) setLoading(false)
		}
	}, [role, target])

	const markRead = useCallback(
		async (conversationId: number, messageId: number | null) => {
			try {
				await api(
					`/messaging/conversations/${conversationId}/read`,
					{
						method: 'POST',
						body: JSON.stringify(
							messageId ? { last_message_id: messageId } : {},
						),
					},
					'required',
				)
				setConversation(current =>
					current.conversation_id === conversationId
						? { ...current, unread_count: 0 }
						: current,
				)
				onConversationRead?.(conversationId)
			} catch {
				// Keep the thread usable if read-state update races with polling.
			}
		},
		[onConversationRead],
	)

	useEffect(() => {
		mountedRef.current = true
		void loadConversation()
		return () => {
			mountedRef.current = false
		}
	}, [loadConversation])

	useEffect(() => {
		if (!conversation.conversation_id) return
		void markRead(conversation.conversation_id, lastMessageId)
	}, [conversation.conversation_id, lastMessageId, markRead])

	const submitDraft = useCallback(async () => {
		const body = draft.trim()
		if (!body || sending || loading || !conversation.conversation_id) return

		setSending(true)
		setError('')
		try {
			await api(
				`/messaging/conversations/${conversation.conversation_id}/messages`,
				{ method: 'POST', body: JSON.stringify({ body }) },
				'required',
			)
			setDraft('')
			const detail = await api<MessagingConversationDetailResponse>(
				`/messaging/conversations/${conversation.conversation_id}/messages?limit=80`,
				undefined,
				'required',
			)
			setConversation(normalizeConversation(detail, target))
			setMessages(normalizeMessages(detail))
			showSuccessToast('Сообщение отправлено.')
		} catch (sendError) {
			const message =
				sendError instanceof Error
					? sendError.message
					: 'Не удалось отправить сообщение.'
			setError(message)
			showErrorToast(message)
		} finally {
			setSending(false)
		}
	}, [conversation.conversation_id, draft, loading, sending, target])

	useReactHotkeys(draftRef, [
		{
			key: 'Enter',
			enabled: canUseComposer,
			preventDefault: event => !event.shiftKey && !event.isComposing,
			handler: event => {
				if (event.shiftKey || event.isComposing) return
				void submitDraft()
			},
		},
	])

	async function sendMessage(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		await submitDraft()
	}

	return (
		<aside className='messaging-panel codequest-card p-0' data-motion-reveal>
			<header className='messaging-panel__header flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6'>
				<div className='min-w-0'>
					<p className='brand-eyebrow'>Сообщения</p>
					<h3 className='mt-2 break-words text-2xl font-black text-slate-900'>
						{title}
					</h3>
					<p className='mt-1 text-sm text-slate-500'>{subtitle}</p>
				</div>
				<div className='flex items-center gap-2'>
					<button
						type='button'
						onClick={loadConversation}
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

			<div className='messaging-panel__body px-5 pb-5 sm:px-6 sm:pb-6'>
				{conversation.unread_count > 0 ? (
					<div className='mb-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700'>
						Непрочитанных в этом чате: {conversation.unread_count}. После открытия статус обновится.
					</div>
				) : null}

				{error ? (
					<div className='mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700'>
						{error}
					</div>
				) : null}

				<div className='messaging-panel__thread' data-motion-stagger>
					{loading ? (
						<div className='flex min-h-56 items-center justify-center gap-2 text-sm font-semibold text-slate-500'>
							<Loader2 className='animate-spin' size={18} />
							Загружаем переписку…
						</div>
					) : messages.length ? (
						messages.map(message => {
							const own = isOwnMessage(message, role, currentUserId)
							return (
								<div
									key={message.id}
									className={`messaging-panel__message ${own ? 'messaging-panel__message--own' : 'messaging-panel__message--other'}`}
									data-motion-item
								>
									<div className='messaging-panel__bubble'>
										<p className='whitespace-pre-wrap break-words text-sm leading-6'>
											{message.body}
										</p>
										<div className='mt-2 flex flex-wrap items-center justify-between gap-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] opacity-70'>
											<span>{own ? 'Вы' : message.sender_name || (role === 'teacher' ? 'Ученик' : 'Учитель')}</span>
											<span>{formatChatTime(message.created_at)}</span>
										</div>
									</div>
								</div>
							)
						})
					) : (
						<div className='messaging-panel__empty'>
							<Inbox size={28} />
							<p className='mt-3 text-lg font-black text-slate-900'>
								Пока нет сообщений
							</p>
							<p className='mt-1 text-sm text-slate-500'>
								Напишите первый вопрос или короткое обновление по классу.
							</p>
						</div>
					)}
				</div>

				<form onSubmit={sendMessage} className='mt-4 flex flex-col gap-3 sm:flex-row'>
					<textarea
						ref={draftRef}
						value={draft}
						onChange={event => setDraft(event.target.value)}
						disabled={!canUseComposer}
						placeholder='Напишите сообщение…'
						maxLength={400}
						className='min-h-24 flex-1 resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:bg-slate-50 disabled:text-slate-400'
					/>
					<button
						type='submit'
						disabled={!canSend}
						className='brand-button-primary min-w-36 gap-2 disabled:cursor-not-allowed disabled:opacity-55'
					>
						{sending ? <Loader2 className='animate-spin' size={17} /> : <Send size={17} />}
						Отправить
					</button>
				</form>
			</div>
		</aside>
	)
}
