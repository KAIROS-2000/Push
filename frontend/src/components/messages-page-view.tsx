'use client'

import { MessagingPanel } from '@/components/messaging-panel'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { api } from '@/lib/api'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'
import {
	MessagingChatTarget,
	MessagingConversationSummary,
	MessagingRole,
	MessagingSummaryClass,
	MessagingSummaryResponse,
	MessagingSummaryStudent,
	UserItem,
} from '@/types'
import {
	Bell,
	BellOff,
	Inbox,
	Loader2,
	MessageCircle,
	RefreshCw,
	Users,
	X,
} from 'lucide-react'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type TouchEvent,
} from 'react'

type BrowserNotificationPermission =
	| NotificationPermission
	| 'unsupported'

interface MessagesPageViewProps {
	user: UserItem
	initialSummary?: MessagingSummaryResponse | null
}

interface TeacherChatRow {
	id: number
	username: string | null
	fullName: string
	conversationId: number | null
	unread: number
	latestAt: string | null
	latestPreview: string | null
}

interface TeacherClassGroup {
	classroomId: number
	classroomName: string
	students: TeacherChatRow[]
}

interface StudentChatRow {
	classroomId: number
	classroomName: string
	conversationId: number | null
	teacherId: number | null
	teacherName: string
	unread: number
	latestAt: string | null
	latestPreview: string | null
}

function formatMessagingTime(value?: string | null) {
	if (!value) return 'нет сообщений'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return 'нет сообщений'
	return date.toLocaleString('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function messageTimestamp(value?: string | null) {
	if (!value) return 0
	const parsed = new Date(value).getTime()
	return Number.isNaN(parsed) ? 0 : parsed
}

function conversationKey(conversation: MessagingConversationSummary) {
	return [
		conversation.classroom_id,
		conversation.teacher_id ?? 'teacher',
		conversation.student_id ?? 'student',
	].join(':')
}

function summaryClassId(group: MessagingSummaryClass) {
	return group.classroom?.id ?? group.classroom_id ?? group.id ?? null
}

function summaryClassName(group: MessagingSummaryClass) {
	return (
		group.classroom?.name ??
		group.classroom_name ??
		group.name ??
		'Класс без названия'
	)
}

function summaryStudentId(student: MessagingSummaryStudent) {
	return student.student_id ?? student.id ?? null
}

function summaryStudentName(student: MessagingSummaryStudent) {
	return (
		student.student_name ??
		student.full_name ??
		student.username ??
		'Ученик'
	)
}

function findStudentConversation(
	summary: MessagingSummaryResponse | null,
	classroomId: number,
	studentId: number,
): MessagingConversationSummary | null {
	return (
		summary?.conversations.find(
			conversation =>
				conversation.classroom_id === classroomId &&
				conversation.student_id === studentId,
		) ?? null
	)
}

function findClassConversation(
	summary: MessagingSummaryResponse | null,
	classroomId: number,
): MessagingConversationSummary | null {
	return (
		summary?.conversations.find(
			conversation => conversation.classroom_id === classroomId,
		) ?? null
	)
}

function buildTeacherGroups(
	summary: MessagingSummaryResponse | null,
): TeacherClassGroup[] {
	return (summary?.classes ?? [])
		.map(group => {
			const classroomId = summaryClassId(group)
			if (!classroomId) return null

			const students = (group.students ?? [])
				.map(student => {
					const studentId = summaryStudentId(student)
					if (!studentId) return null
					const conversation = findStudentConversation(
						summary,
						classroomId,
						studentId,
					)
					return {
						id: studentId,
						username: student.username ?? null,
						fullName: summaryStudentName(student),
						conversationId:
							student.conversation_id ?? conversation?.conversation_id ?? null,
						unread:
							student.unread_count ?? conversation?.unread_count ?? 0,
						latestAt:
							student.latest_message_at ??
							conversation?.latest_message_at ??
							null,
						latestPreview:
							student.latest_message_preview ??
							conversation?.latest_message_preview ??
							null,
					}
				})
				.filter((student): student is TeacherChatRow => Boolean(student))

			return {
				classroomId,
				classroomName: summaryClassName(group),
				students,
			}
		})
		.filter((group): group is TeacherClassGroup => Boolean(group))
}

function buildStudentChats(
	summary: MessagingSummaryResponse | null,
): StudentChatRow[] {
	return (summary?.classes ?? [])
		.map(group => {
			const classroomId = summaryClassId(group)
			if (!classroomId) return null

			const conversation =
				group.conversation ?? findClassConversation(summary, classroomId)
			return {
				classroomId,
				classroomName: summaryClassName(group),
				conversationId:
					group.conversation_id ?? conversation?.conversation_id ?? null,
				teacherId: group.teacher?.id ?? conversation?.teacher_id ?? null,
				teacherName:
					group.teacher?.full_name ??
					group.teacher?.username ??
					conversation?.teacher_name ??
					'Учитель',
				unread: group.unread_count ?? conversation?.unread_count ?? 0,
				latestAt:
					group.latest_message_at ?? conversation?.latest_message_at ?? null,
				latestPreview:
					group.latest_message_preview ??
					conversation?.latest_message_preview ??
					null,
			}
		})
		.filter((chat): chat is StudentChatRow => Boolean(chat))
}

function isActiveConversation(
	conversation: MessagingConversationSummary,
	target: MessagingChatTarget | null,
	role: MessagingRole,
) {
	if (!target || conversation.classroom_id !== target.classroomId) return false
	if (role === 'teacher') {
		return Boolean(
			target.studentId && conversation.student_id === target.studentId,
		)
	}
	return true
}

function findIncomingIncrease(
	previous: MessagingSummaryResponse | null,
	next: MessagingSummaryResponse,
	activeTarget: MessagingChatTarget | null,
	role: MessagingRole,
) {
	if (!previous) return null

	const previousUnread = new Map(
		previous.conversations.map(conversation => [
			conversationKey(conversation),
			conversation.unread_count,
		]),
	)

	return [...next.conversations]
		.filter(conversation => {
			if (isActiveConversation(conversation, activeTarget, role)) return false
			return (
				conversation.unread_count >
				(previousUnread.get(conversationKey(conversation)) ?? 0)
			)
		})
		.sort(
			(left, right) =>
				messageTimestamp(right.latest_message_at) -
				messageTimestamp(left.latest_message_at),
		)[0] ?? null
}

function notificationBody(
	conversation: MessagingConversationSummary,
	role: MessagingRole,
) {
	if (conversation.latest_message_preview) {
		return conversation.latest_message_preview
	}
	if (role === 'teacher') {
		return `${conversation.student_name ?? 'Ученик'} отправил сообщение.`
	}
	return `${conversation.teacher_name ?? 'Учитель'} отправил сообщение.`
}

export function MessagesPageView({
	user,
	initialSummary = null,
}: MessagesPageViewProps) {
	const role = user.role === 'teacher' ? 'teacher' : 'student'
	const rootRef = useRef<HTMLDivElement | null>(null)
	const previousSummaryRef = useRef<MessagingSummaryResponse | null>(
		initialSummary,
	)
	const pollRef = useRef(false)
	const [summary, setSummary] =
		useState<MessagingSummaryResponse | null>(initialSummary)
	const [activeTarget, setActiveTarget] =
		useState<MessagingChatTarget | null>(null)
	const [contactsOpen, setContactsOpen] = useState(false)
	const [loading, setLoading] = useState(!initialSummary)
	const [error, setError] = useState('')
	const [notificationPermission, setNotificationPermission] =
		useState<BrowserNotificationPermission>('unsupported')
	const swipeStartRef = useRef<{ x: number; y: number } | null>(null)

	const teacherGroups = useMemo(() => buildTeacherGroups(summary), [summary])
	const studentChats = useMemo(() => buildStudentChats(summary), [summary])
	const unreadCount = summary?.total_unread ?? 0
	const hasContacts =
		role === 'teacher'
			? teacherGroups.some(group => group.students.length)
			: studentChats.length > 0

	useUserPageMotion(rootRef, [
		role,
		teacherGroups.length,
		studentChats.length,
		Boolean(activeTarget),
	])

	useEffect(() => {
		if (typeof window === 'undefined' || !('Notification' in window)) {
			setNotificationPermission('unsupported')
			return
		}
		setNotificationPermission(Notification.permission)
	}, [])

	const showIncomingNotification = useCallback(
		(conversation: MessagingConversationSummary) => {
			if (
				notificationPermission !== 'granted' ||
				typeof window === 'undefined' ||
				!('Notification' in window)
			) {
				return false
			}

			try {
				const notification = new Notification(
					role === 'teacher'
						? 'Новое сообщение от ученика'
						: 'Новое сообщение от учителя',
					{
						body: notificationBody(conversation, role),
						icon: '/progyx-logo.png',
						tag: `message-${conversationKey(conversation)}`,
					},
				)
				notification.onclick = () => {
					window.focus()
					notification.close()
				}
				return true
			} catch {
				// Browsers can reject notifications in restrictive modes.
				return false
			}
		},
		[notificationPermission, role],
	)

	const loadSummary = useCallback(
		async ({
			notify = false,
			showFailure = false,
		}: {
			notify?: boolean
			showFailure?: boolean
		} = {}) => {
			if (pollRef.current) return
			pollRef.current = true
			setError('')
			if (!previousSummaryRef.current) setLoading(true)

			try {
				const next = await api<MessagingSummaryResponse>(
					'/messaging/summary',
					undefined,
					'required',
				)
				setSummary(next)

				const incoming = notify
					? findIncomingIncrease(
							previousSummaryRef.current,
							next,
							activeTarget,
							role,
						)
					: null
				if (incoming) {
					const pushed = showIncomingNotification(incoming)
					if (!pushed) {
						showInfoToast(
							role === 'teacher'
								? 'Новое сообщение от ученика.'
								: 'Новое сообщение от учителя.',
						)
					}
				}
				previousSummaryRef.current = next
			} catch (loadError) {
				const message =
					loadError instanceof Error
						? loadError.message
						: 'Не удалось загрузить сообщения.'
				setError(message)
				if (showFailure) {
					showErrorToast(message)
				}
			} finally {
				pollRef.current = false
				setLoading(false)
			}
		},
		[activeTarget, role, showIncomingNotification],
	)

	useEffect(() => {
		void loadSummary()
		const intervalId = window.setInterval(() => {
			void loadSummary({ notify: true })
		}, 25000)

		return () => window.clearInterval(intervalId)
	}, [loadSummary])

	async function enableNotifications() {
		if (typeof window === 'undefined' || !('Notification' in window)) {
			showInfoToast('Браузер не поддерживает push-уведомления.')
			return
		}

		try {
			const permission = await Notification.requestPermission()
			setNotificationPermission(permission)
			if (permission === 'granted') {
				showSuccessToast('Push-уведомления включены.')
			} else if (permission === 'denied') {
				showErrorToast('Разрешение на уведомления заблокировано в браузере.')
			} else {
				showInfoToast('Уведомления можно включить позже.')
			}
		} catch {
			showErrorToast('Не удалось запросить разрешение на уведомления.')
		}
	}

	const selectTarget = useCallback((target: MessagingChatTarget) => {
		setActiveTarget(target)
		setContactsOpen(false)
	}, [])

	function handleWorkspaceTouchStart(event: TouchEvent<HTMLElement>) {
		if (event.touches.length !== 1) return
		const touch = event.touches[0]
		swipeStartRef.current = {
			x: touch.clientX,
			y: touch.clientY,
		}
	}

	function handleWorkspaceTouchEnd(event: TouchEvent<HTMLElement>) {
		const start = swipeStartRef.current
		const touch = event.changedTouches[0]
		swipeStartRef.current = null
		if (!start || !touch) return

		const deltaX = touch.clientX - start.x
		const deltaY = touch.clientY - start.y
		if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
			return
		}

		if (deltaX > 0) {
			setContactsOpen(true)
		} else {
			setContactsOpen(false)
		}
	}

	function renderTeacherContacts() {
		if (loading) {
			return (
				<div className='flex min-h-56 items-center justify-center gap-2 text-sm font-semibold text-slate-500'>
					<Loader2 className='animate-spin' size={18} />
					Загружаем учеников…
				</div>
			)
		}

		if (!teacherGroups.length) {
			return (
				<div className='messaging-panel__empty'>
					<Users size={28} />
					<p className='mt-3 text-lg font-black text-slate-900'>
						Классы пока не найдены
					</p>
					<p className='mt-1 text-sm text-slate-500'>
						Создайте класс в кабинете учителя, чтобы начать переписку.
					</p>
				</div>
			)
		}

		return (
			<div className='space-y-4' data-motion-stagger>
				{teacherGroups.map(group => (
					<section
						key={group.classroomId}
						className='messaging-class-group rounded-[24px] border border-slate-200 bg-slate-50 p-4'
						data-motion-item
					>
						<div className='flex flex-wrap items-center justify-between gap-2'>
							<h2 className='break-words text-lg font-black text-slate-900'>
								{group.classroomName}
							</h2>
							<span className='rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600'>
								{group.students.length} учен.
							</span>
						</div>

						<div className='mt-3 space-y-2'>
							{group.students.length ? (
								group.students.map(student => (
									<button
										key={`${group.classroomId}-${student.id}`}
										type='button'
										onClick={() =>
											selectTarget({
												classroomId: group.classroomId,
												classroomName: group.classroomName,
												conversationId: student.conversationId,
												studentId: student.id,
												studentName: student.fullName,
											})
										}
										className={`teacher-workspace__item w-full rounded-2xl border p-3 text-left transition ${
											activeTarget?.classroomId === group.classroomId &&
											activeTarget?.studentId === student.id
												? 'border-slate-900 bg-white shadow-sm'
												: 'border-slate-200 bg-white'
										}`}
									>
										<div className='flex flex-wrap items-start justify-between gap-3'>
											<div className='min-w-0'>
												<p className='break-words font-black text-slate-900'>
													{student.fullName}
												</p>
												{student.username ? (
													<p className='text-sm text-slate-500'>
														@{student.username}
													</p>
												) : null}
												<p className='mt-1 text-xs font-semibold text-slate-500'>
													{formatMessagingTime(student.latestAt)}
												</p>
											</div>
											{student.unread > 0 ? (
												<span className='messaging-unread-badge'>
													{student.unread}
												</span>
											) : null}
										</div>
										{student.latestPreview ? (
											<p className='mt-2 truncate text-sm text-slate-500'>
												{student.latestPreview}
											</p>
										) : null}
									</button>
								))
							) : (
								<p className='rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500'>
									В этом классе пока нет учеников.
								</p>
							)}
						</div>
					</section>
				))}
			</div>
		)
	}

	function renderStudentContacts() {
		if (loading) {
			return (
				<div className='flex min-h-56 items-center justify-center gap-2 text-sm font-semibold text-slate-500'>
					<Loader2 className='animate-spin' size={18} />
					Загружаем учителей…
				</div>
			)
		}

		if (!studentChats.length) {
			return (
				<div className='messaging-panel__empty'>
					<Inbox size={28} />
					<p className='mt-3 text-lg font-black text-slate-900'>
						Нет подключённых классов
					</p>
					<p className='mt-1 text-sm text-slate-500'>
						Введите код класса в кабинете, чтобы написать учителю.
					</p>
				</div>
			)
		}

		return (
			<div className='space-y-3' data-motion-stagger>
				{studentChats.map(chat => (
					<button
						key={chat.classroomId}
						type='button'
						onClick={() =>
							selectTarget({
								classroomId: chat.classroomId,
								classroomName: chat.classroomName,
								conversationId: chat.conversationId,
								teacherId: chat.teacherId,
								teacherName: chat.teacherName,
							})
						}
						className={`teacher-workspace__item w-full rounded-[24px] border p-4 text-left transition ${
							activeTarget?.classroomId === chat.classroomId
								? 'border-slate-900 bg-white shadow-sm'
								: 'border-slate-200 bg-slate-50'
						}`}
						data-motion-item
					>
						<div className='flex flex-wrap items-start justify-between gap-3'>
							<div className='min-w-0'>
								<p className='break-words text-lg font-black text-slate-900'>
									{chat.teacherName}
								</p>
								<p className='mt-1 text-sm text-slate-600'>
									{chat.classroomName}
								</p>
								<p className='mt-1 text-xs font-semibold text-slate-500'>
									{formatMessagingTime(chat.latestAt)}
								</p>
							</div>
							{chat.unread > 0 ? (
								<span className='messaging-unread-badge'>{chat.unread}</span>
							) : null}
						</div>
						{chat.latestPreview ? (
							<p className='mt-3 truncate text-sm text-slate-500'>
								{chat.latestPreview}
							</p>
						) : null}
					</button>
				))}
			</div>
		)
	}

	return (
		<div ref={rootRef} className='messages-page space-y-6'>
			<section className='codequest-card p-6' data-motion-hero-copy>
				<div className='flex flex-wrap items-start justify-between gap-4'>
					<div className='min-w-0'>
						<p className='brand-eyebrow'>Сообщения</p>
						<h1 className='mt-3 break-words text-3xl font-black text-slate-900 sm:text-4xl'>
							{role === 'teacher'
								? 'Общение с учениками'
								: 'Общение с учителем'}
						</h1>
						<p className='mt-3 max-w-2xl text-sm leading-6 text-slate-600'>
							{role === 'teacher'
								? 'Выберите ученика в нужном классе и продолжите личную переписку.'
								: 'Выберите класс, чтобы задать вопрос учителю или ответить на сообщение.'}
						</p>
					</div>
					<div className='flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end'>
						<span className='brand-chip brand-chip--soft'>
							{unreadCount} непрочитанных
						</span>
						{notificationPermission === 'granted' ? (
							<span className='brand-chip brand-chip--soft gap-2'>
								<Bell size={15} />
								Push включён
							</span>
						) : notificationPermission === 'denied' ? (
							<span className='brand-chip brand-chip--soft gap-2'>
								<BellOff size={15} />
								Push заблокирован
							</span>
						) : notificationPermission === 'default' ? (
							<button
								type='button'
								onClick={enableNotifications}
								className='brand-button-secondary min-h-10 gap-2 px-4 py-2 text-sm'
							>
								<Bell size={16} />
								Включить push
							</button>
						) : null}
						<button
							type='button'
							onClick={() => loadSummary({ showFailure: true })}
							disabled={pollRef.current}
							className='messaging-icon-button'
							aria-label='Обновить список сообщений'
						>
							<RefreshCw
								size={17}
								className={pollRef.current ? 'animate-spin' : ''}
							/>
						</button>
					</div>
				</div>
			</section>

			<div className='messages-page__mobile-toolbar' data-motion-reveal>
				<button
					type='button'
					onClick={() => setContactsOpen(true)}
					className='brand-button-secondary messages-page__contacts-toggle gap-2'
					aria-controls='messages-contacts-panel'
					aria-expanded={contactsOpen}
				>
					<Users size={17} />
					Контакты
					{unreadCount > 0 ? (
						<span className='messaging-unread-badge'>{unreadCount}</span>
					) : null}
				</button>
			</div>

			<section
				className={`messages-page__workspace ${contactsOpen ? 'messages-page__workspace--contacts-open' : ''}`}
				onTouchStart={handleWorkspaceTouchStart}
				onTouchEnd={handleWorkspaceTouchEnd}
			>
				{contactsOpen ? (
					<button
						type='button'
						className='messages-page__contacts-scrim'
						aria-label='Закрыть контакты'
						onClick={() => setContactsOpen(false)}
					/>
				) : null}

				<aside
					id='messages-contacts-panel'
					className={`messages-page__contacts codequest-card p-5 sm:p-6 ${contactsOpen ? 'messages-page__contacts--open' : ''}`}
				>
					<div className='messages-page__contacts-mobile-header'>
						<span className='text-sm font-black uppercase tracking-[0.16em] text-slate-500'>
							Контакты
						</span>
						<button
							type='button'
							onClick={() => setContactsOpen(false)}
							className='messaging-icon-button'
							aria-label='Закрыть контакты'
						>
							<X size={18} />
						</button>
					</div>
					<div className='flex flex-wrap items-center justify-between gap-3'>
						<div>
							<p className='brand-eyebrow'>
								{role === 'teacher' ? 'Ученики' : 'Учителя'}
							</p>
							<h2 className='mt-2 text-2xl font-black text-slate-900'>
								{role === 'teacher' ? 'Контакты по классам' : 'Мои классы'}
							</h2>
						</div>
						{hasContacts ? (
							<span className='rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600'>
								{role === 'teacher'
									? teacherGroups.reduce(
											(total, group) => total + group.students.length,
											0,
										)
									: studentChats.length}{' '}
								чат.
							</span>
						) : null}
					</div>

					{error ? (
						<div className='mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700'>
							{error}
						</div>
					) : null}

					<div className='mt-5'>
						{role === 'teacher'
							? renderTeacherContacts()
							: renderStudentContacts()}
					</div>
				</aside>

				<div className='messages-page__chat' data-motion-reveal>
					{activeTarget ? (
						<MessagingPanel
							role={role}
							target={activeTarget}
							currentUserId={user.id}
							onClose={() => setActiveTarget(null)}
							onConversationRead={() => loadSummary()}
						/>
					) : (
						<article className='messaging-panel codequest-card p-0'>
							<header className='messaging-panel__header p-5 sm:p-6'>
								<p className='brand-eyebrow'>Чат</p>
								<h2 className='mt-2 text-2xl font-black text-slate-900'>
									Выберите собеседника
								</h2>
								<p className='mt-1 text-sm text-slate-500'>
									История переписки откроется справа после выбора контакта.
								</p>
							</header>
							<div className='messaging-panel__body p-5 sm:p-6'>
								<div className='messaging-panel__empty'>
									<MessageCircle size={30} />
									<p className='mt-3 text-lg font-black text-slate-900'>
										Чат не выбран
									</p>
									<p className='mt-1 text-sm text-slate-500'>
										Сообщения создаются в контексте конкретного класса.
									</p>
								</div>
							</div>
						</article>
					)}
				</div>
			</section>
		</div>
	)
}
