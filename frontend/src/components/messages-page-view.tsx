'use client'

import Link from 'next/link'
import { MessagingPanel } from '@/components/messaging-panel'
import { ParentTeacherChatPanel } from '@/components/parent-teacher-chat-panel'
import { StaffDirectThreadPanel } from '@/components/staff-direct-thread-panel'
import { RolePill } from '@/components/role-pill'
import { UserLocalTime } from '@/components/user-local-time'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showInfoToast, showSuccessToast } from '@/lib/toast'
import {
	MessagingChatTarget,
	MessagingConversationSummary,
	MessagingRole,
	MessagingSummaryClass,
	MessagingSummaryResponse,
	MessagingSummaryStudent,
	StaffDirectThreadRow,
	TeacherParentThreadRow,
	TeacherParentThreadsResponse,
	type UserRole,
	UserItem,
} from '@/types'
import {
	Bell,
	BellOff,
	ChevronRight,
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

interface ParentClassroomContact {
	thread_id: number | null
	child: { id: number; full_name: string | null }
	teacher: { id: number; full_name: string | null }
	classroom: { id: number; name: string | null }
	updated_at: string | null
	latest_preview: string | null
	unread_count: number
	can_message: boolean
}

type ParentTeacherChatOpen = {
	threadId: number
	canMessage: boolean
	title: string
}

function normalizeParentMessagingThreads(payload: {
	classroom_contacts?: ParentClassroomContact[]
	threads?: Array<{
		id: number
		child: ParentClassroomContact['child']
		teacher: ParentClassroomContact['teacher']
		classroom: ParentClassroomContact['classroom']
		updated_at?: string | null
		latest_preview?: string | null
		unread_count?: number
	}>
}): ParentClassroomContact[] {
	const raw = payload.classroom_contacts
	if (raw && raw.length) return raw
	if (payload.threads?.length) {
		return payload.threads.map(t => ({
			thread_id: t.id,
			child: t.child,
			teacher: t.teacher,
			classroom: t.classroom,
			updated_at: t.updated_at ?? null,
			latest_preview: t.latest_preview ?? null,
			unread_count: t.unread_count ?? 0,
			can_message: true,
		}))
	}
	return []
}

interface TeacherChatRow {
	id: number
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

function groupParentThreadsByParent(
	threads: TeacherParentThreadRow[],
): { parent: TeacherParentThreadRow['parent']; threads: TeacherParentThreadRow[] }[] {
	const m = new Map<
		number,
		{ parent: TeacherParentThreadRow['parent']; threads: TeacherParentThreadRow[] }
	>()
	for (const t of threads) {
		const pid = t.parent.id
		if (!m.has(pid)) {
			m.set(pid, { parent: t.parent, threads: [] })
		}
		m.get(pid)!.threads.push(t)
	}
	for (const g of m.values()) {
		g.threads.sort(
			(a, b) => messageTimestamp(b.updated_at) - messageTimestamp(a.updated_at),
		)
	}
	return [...m.values()].sort((a, b) =>
		(a.parent.full_name || '').localeCompare(b.parent.full_name || '', 'ru'),
	)
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
					group.teacher?.email ??
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
	if (target.kind === 'parent_thread') return false
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
	const role: MessagingRole =
		user.role === 'teacher' ? 'teacher' : user.role === 'parent' ? 'parent' : 'student'
	const rootRef = useRef<HTMLDivElement | null>(null)
	const previousSummaryRef = useRef<MessagingSummaryResponse | null>(
		initialSummary,
	)
	const pollRef = useRef(false)
	const [summary, setSummary] =
		useState<MessagingSummaryResponse | null>(initialSummary)
	const [parentThreads, setParentThreads] = useState<TeacherParentThreadRow[]>([])
	const [expandedParentIds, setExpandedParentIds] = useState<Set<number>>(
		() => new Set(),
	)
	const previousParentUnreadRef = useRef<Map<number, number>>(new Map())
	const [activeTarget, setActiveTarget] = useState<MessagingChatTarget | null>(null)
	const [activeStaffRow, setActiveStaffRow] = useState<StaffDirectThreadRow | null>(null)
	const [contactsOpen, setContactsOpen] = useState(false)
	const [loading, setLoading] = useState(!initialSummary)
	const [error, setError] = useState('')
	const [notificationPermission, setNotificationPermission] =
		useState<BrowserNotificationPermission>('unsupported')
	const swipeStartRef = useRef<{ x: number; y: number } | null>(null)
	const [parentClassroomContacts, setParentClassroomContacts] = useState<
		ParentClassroomContact[]
	>([])
	const [parentChatOpen, setParentChatOpen] = useState<ParentTeacherChatOpen | null>(null)
	const [parentChatStarting, setParentChatStarting] = useState(false)
	const [parentActiveContactKey, setParentActiveContactKey] = useState<string | null>(null)

	const teacherGroups = useMemo(() => buildTeacherGroups(summary), [summary])
	const studentChats = useMemo(() => buildStudentChats(summary), [summary])
	const parentGroups = useMemo(
		() => groupParentThreadsByParent(parentThreads),
		[parentThreads],
	)
	const parentUnreadTotal = useMemo(
		() => parentThreads.reduce((sum, t) => sum + (t.unread_count ?? 0), 0),
		[parentThreads],
	)
	const parentTeacherUnreadTotal = useMemo(
		() =>
			parentClassroomContacts.reduce((sum, c) => sum + (c.unread_count ?? 0), 0),
		[parentClassroomContacts],
	)
	const unreadCount =
		user.role === 'parent'
			? (summary?.total_unread ?? 0) + parentTeacherUnreadTotal
			: (summary?.total_unread ?? 0) + (user.role === 'teacher' ? parentUnreadTotal : 0)
	const staffThreads = summary?.staff_direct?.threads ?? []
	const hasStaffDirect = staffThreads.length > 0
	const hasContacts =
		user.role === 'parent'
			? hasStaffDirect || parentClassroomContacts.length > 0
			: role === 'teacher'
				? teacherGroups.some(group => group.students.length) ||
						parentThreads.length > 0 ||
						hasStaffDirect
				: studentChats.length > 0 || hasStaffDirect
	const teacherListTotal = useMemo(() => {
		if (user.role !== 'teacher') return 0
		return (
			teacherGroups.reduce((acc, g) => acc + g.students.length, 0) +
			parentThreads.length
		)
	}, [user.role, teacherGroups, parentThreads])

	const parentContactsByChild = useMemo(() => {
		const m = new Map<
			number,
			{ childName: string; contacts: ParentClassroomContact[] }
		>()
		for (const c of parentClassroomContacts) {
			const id = c.child.id
			if (!m.has(id)) {
				m.set(id, {
					childName: c.child.full_name || 'Ребёнок',
					contacts: [],
				})
			}
			m.get(id)!.contacts.push(c)
		}
		for (const g of m.values()) {
			g.contacts.sort(
				(a, b) => messageTimestamp(b.updated_at) - messageTimestamp(a.updated_at),
			)
		}
		return [...m.entries()].sort((a, b) =>
			a[1].childName.localeCompare(b[1].childName, 'ru'),
		)
	}, [parentClassroomContacts])

	useUserPageMotion(rootRef, [
		role,
		teacherGroups.length,
		studentChats.length,
		parentThreads.length,
		parentClassroomContacts.length,
		Boolean(activeTarget),
		Boolean(activeStaffRow),
		Boolean(parentChatOpen),
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

	const loadParentClassroomContacts = useCallback(async () => {
		if (user.role !== 'parent') return
		try {
			const th = await api<{
				classroom_contacts?: ParentClassroomContact[]
				threads?: Array<{
					id: number
					child: ParentClassroomContact['child']
					teacher: ParentClassroomContact['teacher']
					classroom: ParentClassroomContact['classroom']
					updated_at?: string | null
					latest_preview?: string | null
					unread_count?: number
				}>
			}>('/parent/messaging/threads', undefined, 'required')
			setParentClassroomContacts(normalizeParentMessagingThreads(th))
		} catch {
			// keep prior list on transient errors
		}
	}, [user.role])

	const openParentTeacherChat = useCallback(
		async (c: ParentClassroomContact) => {
			const contactKey = `${c.classroom.id}-${c.child.id}`
			setParentActiveContactKey(contactKey)
			const title = `${c.teacher.full_name || 'Педагог'} · ${c.classroom.name || 'Класс'}`
			if (c.thread_id) {
				setParentChatOpen({ threadId: c.thread_id, canMessage: c.can_message, title })
				return
			}
			setParentChatStarting(true)
			try {
				const r = await api<{ id: number }>(
					'/parent/messaging/threads',
					{
						method: 'POST',
						body: JSON.stringify({
							child_id: c.child.id,
							classroom_id: c.classroom.id,
						}),
					},
					'required',
				)
				setParentChatOpen({ threadId: r.id, canMessage: c.can_message, title })
				await loadParentClassroomContacts()
			} catch (e) {
				showErrorToast(getApiErrorMessage(e, 'Не удалось открыть чат.'))
				setParentActiveContactKey(null)
			} finally {
				setParentChatStarting(false)
			}
		},
		[loadParentClassroomContacts],
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
				const [next, parentPayload] = await Promise.all([
					api<MessagingSummaryResponse>('/messaging/summary', undefined, 'required'),
					user.role === 'teacher'
						? api<TeacherParentThreadsResponse>(
								'/teacher/parent-threads',
								undefined,
								'required',
							).catch(() => ({ parent_threads: [] as TeacherParentThreadRow[] }))
						: Promise.resolve<TeacherParentThreadsResponse>({
								parent_threads: [],
							}),
				])
				setSummary(next)
				if (user.role === 'teacher') {
					const rows = parentPayload.parent_threads ?? []
					setParentThreads(rows)
					if (notify) {
						for (const t of rows) {
							const prevU = previousParentUnreadRef.current.get(t.id) ?? 0
							if ((t.unread_count ?? 0) > prevU) {
								const isActive =
									activeTarget?.kind === 'parent_thread' &&
									activeTarget.parentThreadId === t.id
								if (!isActive) {
									showInfoToast('Новое сообщение от родителя.')
									break
								}
							}
						}
						previousParentUnreadRef.current = new Map(
							rows.map(t => [t.id, t.unread_count ?? 0]),
						)
					} else {
						previousParentUnreadRef.current = new Map(
							rows.map(t => [t.id, t.unread_count ?? 0]),
						)
					}
				}

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
		[activeTarget, role, showIncomingNotification, user.role],
	)

	useEffect(() => {
		void loadSummary()
		if (user.role === 'parent') {
			void loadParentClassroomContacts()
		}
		const intervalId = window.setInterval(() => {
			void loadSummary({ notify: true })
			if (user.role === 'parent') {
				void loadParentClassroomContacts()
			}
		}, 25000)

		return () => window.clearInterval(intervalId)
	}, [loadSummary, loadParentClassroomContacts, user.role])

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
		setActiveStaffRow(null)
		setActiveTarget(target)
		setContactsOpen(false)
	}, [])

	const selectStaffRow = useCallback((row: StaffDirectThreadRow) => {
		setActiveTarget(null)
		setActiveStaffRow(row)
		setContactsOpen(false)
		if (user.role === 'parent') {
			setParentActiveContactKey(null)
			setParentChatOpen(null)
		}
	}, [user.role])

	const toggleParentExpand = useCallback((parentId: number) => {
		setExpandedParentIds(prev => {
			const next = new Set(prev)
			if (next.has(parentId)) next.delete(parentId)
			else next.add(parentId)
			return next
		})
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
					Загружаем контакты…
				</div>
			)
		}

		if (!teacherGroups.length && !parentThreads.length) {
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
								group.students.map(student => {
									const isStudentChatActive =
										Boolean(activeTarget) &&
										(!activeTarget?.kind ||
											activeTarget.kind === 'class_student') &&
										activeTarget?.classroomId === group.classroomId &&
										activeTarget?.studentId === student.id
									return (
										<button
											key={`${group.classroomId}-${student.id}`}
											type='button'
											onClick={() =>
												selectTarget({
													kind: 'class_student',
													classroomId: group.classroomId,
													classroomName: group.classroomName,
													conversationId: student.conversationId,
													studentId: student.id,
													studentName: student.fullName,
												})
											}
											className={`teacher-workspace__item w-full rounded-2xl border p-3 text-left transition ${
												isStudentChatActive
													? 'border-slate-900 bg-white shadow-sm'
													: 'border-slate-200 bg-white'
											}`}
										>
											<div className='flex flex-wrap items-start justify-between gap-3'>
												<div className='min-w-0'>
													<div className='flex flex-wrap items-center gap-2'>
														<p className='break-words font-black text-slate-900'>
															{student.fullName}
														</p>
														<RolePill role='student' />
													</div>
													<p className='mt-1 text-xs font-semibold text-slate-500'>
														<UserLocalTime
															iso={student.latestAt}
															variant='chat'
															emptyLabel='нет сообщений'
															invalidLabel='нет сообщений'
														/>
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
									)
								})
							) : (
								<p className='rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500'>
									В этом классе пока нет учеников.
								</p>
							)}
						</div>
					</section>
				))}

				{parentGroups.length ? (
					<section
						className='messaging-class-group rounded-[24px] border border-amber-200/80 bg-amber-50/40 p-4'
						data-motion-item
					>
						<div className='flex flex-wrap items-center justify-between gap-2'>
							<h2 className='break-words text-lg font-black text-slate-900'>
								Родители
							</h2>
							<span className='rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600'>
								{parentGroups.length} род.
							</span>
						</div>
						<p className='mt-1 text-xs text-slate-500'>
							Нажмите на родителя, чтобы увидеть чаты по детям
						</p>

						<div className='mt-3 space-y-2'>
							{parentGroups.map(group => {
								const expanded = expandedParentIds.has(group.parent.id)
								const groupUnread = group.threads.reduce(
									(s, t) => s + (t.unread_count ?? 0),
									0,
								)
								return (
									<div
										key={group.parent.id}
										className='overflow-hidden rounded-2xl border border-amber-200/60 bg-white'
									>
										<button
											type='button'
											onClick={() => toggleParentExpand(group.parent.id)}
											className='flex w-full items-start justify-between gap-3 p-3 text-left transition hover:bg-amber-50/80'
											aria-expanded={expanded}
										>
											<div className='flex min-w-0 items-start gap-2'>
												<ChevronRight
													size={18}
													className={`mt-0.5 shrink-0 text-amber-700 transition-transform duration-300 ease-out ${
														expanded ? 'rotate-90' : ''
													}`}
													aria-hidden
												/>
												<div className='min-w-0'>
													<div className='flex flex-wrap items-center gap-2'>
														<p className='break-words font-black text-slate-900'>
															{group.parent.full_name || 'Родитель'}
														</p>
														<RolePill role='parent' />
													</div>
												</div>
											</div>
											{groupUnread > 0 ? (
												<span className='messaging-unread-badge'>
													{groupUnread}
												</span>
											) : null}
										</button>

										<div
											className='grid transition-[grid-template-rows] duration-300 ease-out'
											style={{
												gridTemplateRows: expanded ? '1fr' : '0fr',
											}}
										>
											<div className='min-h-0 overflow-hidden'>
												<div className='space-y-2 border-t border-amber-100/80 p-2 pt-0'>
													{group.threads.map(thread => {
														const isParentThreadActive =
															activeTarget?.kind === 'parent_thread' &&
															activeTarget.parentThreadId === thread.id
														return (
															<button
																key={thread.id}
																type='button'
																onClick={() =>
																	selectTarget({
																		kind: 'parent_thread',
																		parentThreadId: thread.id,
																		conversationId: thread.id,
																		classroomId: thread.classroom.id,
																		classroomName:
																			thread.classroom.name ||
																			'Класс',
																		studentId: thread.student.id,
																		studentName:
																			thread.student.full_name,
																		parentName: thread.parent.full_name,
																	})
																}
																className={`teacher-workspace__item w-full rounded-xl border p-3 text-left transition ${
																	isParentThreadActive
																		? 'border-slate-900 bg-amber-50/90 shadow-sm'
																		: 'border-slate-200 bg-slate-50/80'
																}`}
															>
																<div className='flex flex-wrap items-start justify-between gap-2'>
																	<div className='min-w-0'>
																		<div className='flex flex-wrap items-center gap-2'>
																			<p className='break-words font-black text-slate-900'>
																				{thread.student.full_name ||
																					'Ребёнок'}
																			</p>
																			<RolePill role='student' />
																		</div>
																		<p className='mt-0.5 text-sm text-slate-600'>
																			{thread.classroom.name ||
																				'Класс'}
																		</p>
																		<p className='mt-1 text-xs font-semibold text-slate-500'>
																			<UserLocalTime
																				iso={thread.updated_at}
																				variant='chat'
																				emptyLabel='нет сообщений'
																				invalidLabel='нет сообщений'
																			/>
																		</p>
																	</div>
																	{(thread.unread_count ?? 0) > 0 ? (
																		<span className='messaging-unread-badge'>
																			{thread.unread_count}
																		</span>
																	) : null}
																</div>
																{thread.latest_preview ? (
																	<p className='mt-2 truncate text-sm text-slate-500'>
																		{thread.latest_preview}
																	</p>
																) : null}
															</button>
														)
													})}
												</div>
											</div>
										</div>
									</div>
								)
							})}
						</div>
					</section>
				) : null}
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
								<div className='flex flex-wrap items-center gap-2'>
									<p className='break-words text-lg font-black text-slate-900'>
										{chat.teacherName}
									</p>
									<RolePill role='teacher' />
								</div>
								<p className='mt-1 text-sm text-slate-600'>
									{chat.classroomName}
								</p>
								<p className='mt-1 text-xs font-semibold text-slate-500'>
									<UserLocalTime
										iso={chat.latestAt}
										variant='chat'
										emptyLabel='нет сообщений'
										invalidLabel='нет сообщений'
									/>
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
								? 'Общение с учениками и родителями'
								: role === 'parent'
									? 'Сообщения'
									: 'Общение с учителем'}
						</h1>
						<p className='mt-3 max-w-2xl text-sm leading-6 text-slate-600'>
							{role === 'teacher'
								? 'Переписка с учениками по классам и с родителями в контексте ребёнка. В чате видно, кто написал — ученик или родитель.'
								: role === 'parent'
									? 'Чаты с учителями по классам ваших детей и переписка с администрацией. Отчёты, согласия и безопасность — в семейном кабинете.'
									: 'Выберите класс, чтобы задать вопрос учителю или ответить на сообщение. В истории указана роль отправителя.'}
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
							onClick={() => {
								void loadSummary({ showFailure: true })
								if (user.role === 'parent') void loadParentClassroomContacts()
							}}
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
								{role === 'teacher' ? 'Диалоги' : role === 'parent' ? 'Адресаты' : 'Учителя'}
							</p>
							<h2 className='mt-2 text-2xl font-black text-slate-900'>
								{role === 'teacher'
									? 'Ученики и родители'
									: role === 'parent'
										? 'Педагоги и администрация'
										: 'Мои классы'}
							</h2>
						</div>
						{hasContacts ? (
							<span className='rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600'>
								{role === 'teacher'
									? teacherListTotal
									: role === 'parent'
										? staffThreads.length + parentClassroomContacts.length
										: studentChats.length}{' '}
								{role === 'parent' ? 'диал.' : 'чат.'}
							</span>
						) : null}
					</div>

					{error ? (
						<div className='mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700'>
							{error}
						</div>
					) : null}

					<div className='mt-5 space-y-5'>
						{hasStaffDirect ? (
							<section className='rounded-[24px] border border-indigo-200/80 bg-indigo-50/50 p-4'>
								<p className='brand-eyebrow text-indigo-900'>Администрация</p>
								<h3 className='mt-2 text-lg font-black text-slate-900'>Сообщения от админов</h3>
								<div className='mt-3 space-y-2'>
									{staffThreads.map(row => {
										const active = activeStaffRow?.thread_id === row.thread_id
										return (
											<button
												key={row.thread_id}
												type='button'
												onClick={() => selectStaffRow(row)}
												className={`flex w-full items-start justify-between gap-2 rounded-2xl border px-3 py-2.5 text-left transition ${
													active
														? 'border-slate-900 bg-white shadow-sm'
														: 'border-slate-200 bg-white/80 hover:border-slate-300'
												}`}
											>
												<div className='min-w-0'>
													<div className='flex flex-wrap items-center gap-2'>
														<p className='font-semibold text-slate-900'>
															{row.other.full_name || row.other.email}
														</p>
														<RolePill role={row.other.role as UserRole} />
													</div>
													<p className='text-xs text-slate-500'>{row.other.email}</p>
												</div>
												{row.unread_count > 0 ? (
													<span className='messaging-unread-badge'>{row.unread_count}</span>
												) : null}
											</button>
										)
									})}
								</div>
							</section>
						) : null}
						{user.role === 'parent' ? (
							<section className='rounded-[24px] border border-sky-200/80 bg-sky-50/40 p-4'>
								<p className='brand-eyebrow text-sky-900'>Педагоги</p>
								<h3 className='mt-2 text-lg font-black text-slate-900'>По детям и классам</h3>
								<p className='mt-1 text-sm text-slate-600'>
									Учителя классов ваших детей. Привязать ребёнка можно в{' '}
									<Link href='/parent/dashboard' className='font-semibold text-slate-900 underline'>
										семейном кабинете
									</Link>
									.
								</p>
								{parentContactsByChild.length ? (
									<div className='mt-4 space-y-4'>
										{parentContactsByChild.map(([childId, group]) => (
											<div
												key={childId}
												className='rounded-2xl border border-slate-200/80 bg-white/90 p-3'
											>
												<div className='flex flex-wrap items-center gap-2'>
													<p className='font-black text-slate-900'>{group.childName}</p>
													<RolePill role='student' />
												</div>
												<ul className='mt-2 space-y-2'>
													{group.contacts.map(c => {
														const rowKey = `${c.classroom.id}-${c.child.id}`
														const isRowActive = parentActiveContactKey === rowKey
														return (
															<li key={rowKey}>
																<button
																	type='button'
																	disabled={parentChatStarting || !c.can_message}
																	title={
																		!c.can_message
																			? 'Включите связь в разделе «Согласия» семейного кабинета'
																			: undefined
																	}
																	onClick={() => void openParentTeacherChat(c)}
																	className={`flex w-full items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
																		isRowActive
																			? 'border-slate-900 bg-sky-50 shadow-sm'
																			: 'border-slate-200 bg-slate-50/80 hover:border-slate-300'
																	} ${!c.can_message ? 'opacity-60' : ''}`}
																>
																	<div className='min-w-0'>
																		<p className='font-semibold text-slate-900'>
																			{c.teacher.full_name || 'Педагог'}{' '}
																			<span className='font-normal text-slate-500'>·</span>{' '}
																			{c.classroom.name || 'Класс'}
																		</p>
																		{c.latest_preview ? (
																			<p className='mt-1 line-clamp-2 text-xs text-slate-500'>
																				{c.latest_preview}
																			</p>
																		) : null}
																	</div>
																	<div className='flex shrink-0 flex-col items-end gap-1'>
																		{c.unread_count > 0 ? (
																			<span className='messaging-unread-badge'>
																				{c.unread_count}
																			</span>
																		) : null}
																		<span className='whitespace-nowrap rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-600'>
																			{!c.can_message
																				? 'Связь отключена'
																				: c.thread_id
																					? 'Открыть'
																					: 'Написать'}
																		</span>
																	</div>
																</button>
															</li>
														)
													})}
												</ul>
											</div>
										))}
									</div>
								) : !loading ? (
									<p className='mt-4 text-sm text-slate-600'>
										Пока нет контактов. Привяжите ребёнка в семейном кабинете; когда он вступит в класс,
										здесь появятся педагоги.
									</p>
								) : null}
								<p className='mt-4 text-xs text-slate-500'>
									Согласия и безопасность — там же, в семейном кабинете.
								</p>
							</section>
						) : null}
						{role === 'teacher'
							? renderTeacherContacts()
							: role === 'parent'
								? null
								: renderStudentContacts()}
					</div>
				</aside>

				<div className='messages-page__chat' data-motion-reveal>
					{activeStaffRow ? (
						<StaffDirectThreadPanel
							threadId={activeStaffRow.thread_id}
							peer={activeStaffRow.other}
							currentUserId={user.id}
							onClose={() => setActiveStaffRow(null)}
							onRead={() => loadSummary()}
						/>
					) : activeTarget ? (
						<MessagingPanel
							role={user.role === 'teacher' ? 'teacher' : 'student'}
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
									{user.role === 'parent' ? 'Выберите чат' : 'Выберите собеседника'}
								</h2>
								<p className='mt-1 text-sm text-slate-500'>
									{user.role === 'parent'
										? 'Слева выберите учителя или администратора. Чат с педагогом открывается в окне поверх страницы.'
										: 'История переписки откроется справа после выбора контакта.'}
								</p>
							</header>
							<div className='messaging-panel__body p-5 sm:p-6'>
								<div className='messaging-panel__empty'>
									<MessageCircle size={30} />
									<p className='mt-3 text-lg font-black text-slate-900'>
										Чат не выбран
									</p>
									<p className='mt-1 text-sm text-slate-500'>
										{user.role === 'parent'
											? 'Выберите контакт слева: переписка с учителем откроется здесь; с администрацией — в панели справа.'
											: 'Сообщения с учителем ведутся в контексте класса. Ответы администрации — в блоке «Администрация».'}
									</p>
								</div>
							</div>
						</article>
					)}
				</div>
			</section>
			{parentChatOpen ? (
				<ParentTeacherChatPanel
					threadId={parentChatOpen.threadId}
					currentUserId={user.id}
					canMessage={parentChatOpen.canMessage}
					title={parentChatOpen.title}
					onClose={() => {
						setParentChatOpen(null)
						setParentActiveContactKey(null)
					}}
					onSent={() => {
						void loadParentClassroomContacts()
						void loadSummary()
					}}
				/>
			) : null}
		</div>
	)
}
