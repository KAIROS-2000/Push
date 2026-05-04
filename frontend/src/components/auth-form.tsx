'use client'

import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import {
	ApiError,
	api,
	getApiErrorMessage,
	resendVerification,
} from '@/lib/api'
import { queueMascotScenario } from '@/lib/mascot'
import { setAuthenticatedSession } from '@/lib/session-store'
import { setTheme } from '@/lib/theme'
import { isValidRuPhone, normalizeRuPhoneInput } from '@/lib/phone'
import { showErrorToast } from '@/lib/toast'
import { AuthOptions, UserItem } from '@/types'
import Image from 'next/image'
import Link from 'next/link'
import { FormEvent, useMemo, useRef, useState } from 'react'

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const PASSWORD_WHITESPACE_RE = /\s/

function strengthLabel(password: string) {
	if (password.length < 10) return 'Слабый'
	const score = [
		/[a-z]/.test(password),
		/[A-Z]/.test(password),
		/\d/.test(password),
		/[^A-Za-z0-9]/.test(password),
	].filter(Boolean).length
	if (score >= 4) return 'Сильный'
	return 'Средний'
}

function isValidEmail(value: string) {
	return EMAIL_RE.test(value.trim().toLowerCase())
}

function hasPasswordWhitespace(value: string) {
	return PASSWORD_WHITESPACE_RE.test(value)
}

function roleLabel(role: string) {
	if (role === 'teacher') return 'Учитель'
	if (role === 'parent') return 'Родитель'
	return 'Ученик'
}

export function AuthForm({
	mode,
	options,
}: {
	mode: 'login' | 'register'
	options?: AuthOptions
}) {
	const rootRef = useRef<HTMLElement | null>(null)
	const [showPassword, setShowPassword] = useState(false)
	const [loading, setLoading] = useState(false)
	const [notice, setNotice] = useState<string | null>(null)
	const [postRegisterEmail, setPostRegisterEmail] = useState<string | null>(null)
	const [postRegisterRole, setPostRegisterRole] = useState<UserItem['role'] | null>(null)
	const [resending, setResending] = useState(false)
	// Surfaced when the login response says email_not_verified — gives the
	// user a clear explanation + a "send link again" button right next to
	// the form they just submitted.
	const [unverifiedLoginEmail, setUnverifiedLoginEmail] = useState<string | null>(null)
	const [form, setForm] = useState({
		full_name: '',
		email: '',
		phone: '',
		password: '',
		role: 'student',
		age_group: 'middle',
		theme: 'light' as UserItem['theme'],
	})

	const isTeacherRegistration = mode === 'register' && form.role === 'teacher'
	const isParentRegistration = mode === 'register' && form.role === 'parent'
	const strength = useMemo(() => strengthLabel(form.password), [form.password])

	useUserPageMotion(rootRef, [mode, isTeacherRegistration, isParentRegistration, strength])

	async function handleSubmit(event: FormEvent) {
		event.preventDefault()
		const normalizedCredential = form.email.trim().toLowerCase()
		const normalizedRegPhone = normalizeRuPhoneInput(form.phone)

		setUnverifiedLoginEmail(null)

		if (mode === 'register' && !isValidEmail(normalizedCredential)) {
			showErrorToast('Укажите корректный email.')
			return
		}

		// Parent self-signup is intentionally email-only: backend generates a
		// password and sends it by email together with the verification link.
		// Phone, name and email confirmation are required only at the
		// "attach a child" step inside the cabinet.
		if (mode === 'register' && !isParentRegistration) {
			if (!form.password) {
				showErrorToast('Укажите пароль.')
				return
			}
			if (form.password.length < 10) {
				showErrorToast('Пароль должен содержать не менее 10 символов.')
				return
			}
			if (hasPasswordWhitespace(form.password)) {
				showErrorToast('Пароль не должен содержать пробелы.')
				return
			}
			if (!isTeacherRegistration && !form.age_group) {
				showErrorToast('Выберите возрастную группу ученика.')
				return
			}
			if (!form.phone.trim()) {
				showErrorToast('Укажите номер телефона.')
				return
			}
			if (!isValidRuPhone(normalizedRegPhone)) {
				showErrorToast(
					'Укажите корректный российский номер телефона (например +7 912 345-67-89).',
				)
				return
			}
		}
		if (mode === 'login' && !normalizedCredential) {
			showErrorToast('Укажите email.')
			return
		}

		setNotice(null)
		setLoading(true)

		try {
			const payload =
				mode === 'login'
					? { login: normalizedCredential, password: form.password }
					: isParentRegistration
						? {
								email: normalizedCredential,
								role: 'parent',
								theme: form.theme,
							}
						: {
								full_name: form.full_name,
								email: normalizedCredential,
								phone: normalizedRegPhone!,
								password: form.password,
								role: form.role,
								theme: form.theme,
								...(isTeacherRegistration ? {} : { age_group: form.age_group }),
							}

			const result = await api<{
				user?: UserItem
				status?: 'pending'
				message?: string
				verification_email_sent?: boolean
				requires_email_verification?: boolean
				requires_login_after_verification?: boolean
			}>('/auth/' + mode, {
				method: 'POST',
				body: JSON.stringify(payload),
			})
			if (mode === 'register' && result.status === 'pending') {
				setPostRegisterEmail(normalizedCredential)
				setPostRegisterRole('teacher')
				setNotice(
					result.message
						|| 'Заявка учителя отправлена администратору. Подтвердите email по ссылке из письма — без этого войти не получится даже после одобрения.',
				)
				setForm({ ...form, password: '' })
				return
			}
			if (!result.user) {
				throw new Error('Сервер не вернул данные пользователя.')
			}

			if (mode === 'register') {
				const isStudent = result.user.role === 'student'
				const isParent = result.user.role === 'parent'
				if (isParent) {
					// Parent: backend creates a session immediately. We still park
					// them on the cabinet entry, but the welcome card from
					// parent-cabinet-page will prompt them to fill profile & verify.
					setAuthenticatedSession(result.user)
					setTheme(result.user?.theme || form.theme)
					window.location.href = '/parent/dashboard'
					return
				}
				// Student: backend deliberately does NOT create a session — the
				// user must verify their email before we let them in. Show a
				// "check your inbox" screen with a resend button.
				if (isStudent) {
					queueMascotScenario('post_register_intro')
				}
				setPostRegisterEmail(result.user.email)
				setPostRegisterRole(result.user.role)
				setNotice(
					result.verification_email_sent === false
						? 'Регистрация прошла, но письмо подтверждения не было отправлено. Запросите его повторно ниже.'
						: 'Мы отправили письмо для подтверждения email. Откройте его и нажмите кнопку — после этого вы сможете войти в кабинет.',
				)
				setForm({ ...form, password: '' })
				return
			}
			setAuthenticatedSession(result.user)
			setTheme(result.user?.theme || form.theme)
			const r = result.user?.role
			if (r === 'parent') {
				window.location.href = '/parent/dashboard'
			} else if (r === 'teacher') {
				window.location.href = '/teacher'
			} else if (r === 'admin') {
				window.location.href = '/admin/users'
			} else if (r === 'superadmin') {
				window.location.href = '/superadmin/users'
			} else {
				window.location.href = '/dashboard'
			}
		} catch (e) {
			if (mode === 'login' && e instanceof ApiError) {
				const code = (e.payload && typeof e.payload === 'object'
					? (e.payload as Record<string, unknown>).code
					: undefined) as string | undefined
				if (code === 'email_not_verified') {
					// Inline panel below the form replaces the toast — keeps the
					// "send letter again" CTA right next to the user's eyes.
					setUnverifiedLoginEmail(normalizedCredential)
					return
				}
			}
			showErrorToast(
				getApiErrorMessage(e, 'Не удалось выполнить действие.'),
			)
		} finally {
			setLoading(false)
		}
	}

	async function handleLoginResendVerification() {
		if (!unverifiedLoginEmail) return
		setResending(true)
		try {
			await resendVerification({ email: unverifiedLoginEmail })
			setNotice('Если аккаунт существует, мы отправили письмо подтверждения повторно. Проверьте почту.')
		} catch (resendError) {
			showErrorToast(
				getApiErrorMessage(
					resendError,
					'Не удалось отправить письмо повторно. Попробуйте позже.',
				),
			)
		} finally {
			setResending(false)
		}
	}

	const infoCards =
		mode === 'login'
			? [
					[
						'Что внутри',
						'Уроки, маршрут, задания, квизы и родительский доступ в одном кабинете.',
					],
					[
						'Кому понятно',
						'Ребёнку легко двигаться дальше, а родителю легко увидеть, как идут дела.',
					],
				]
			: [
					[
						'Старт без путаницы',
						'Регистрация сразу подводит к возрастному маршруту и роли пользователя.',
					],
					[
						'Платформа роста',
						'Уроки, практика, рейтинг, профиль и прогресс уже связаны между собой.',
					],
				]

	return (
		<main ref={rootRef} className='brand-auth-shell'>
			<div className='auth-layout brand-page-shell grid min-h-screen items-start py-6 sm:py-10 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-8'>
				<section
					className='auth-hero-panel order-2 codequest-card grid-bg min-w-0 overflow-hidden p-6 sm:p-8 lg:order-1'
					data-motion-hero-copy
				>
					<div className='flex items-center gap-3'>
						<Image
							src='/progyx-logo.png'
							alt='Логотип Progyx'
							width={52}
							height={52}
							className='h-12 w-12 shrink-0 object-contain'
							priority
						/>
						<div>
							<p className='brand-eyebrow'>Progyx</p>
							<p className='auth-brand-note mt-2 text-sm'>
								IT-школа с понятной подачей для ребёнка и родителя.
							</p>
						</div>
					</div>

					<h1 className='auth-hero-title mt-6 text-[clamp(2rem,8vw,3.35rem)] font-black leading-[0.95] tracking-[-0.05em] text-slate-900'>
						{mode === 'login'
							? 'Возвращаемся к маршруту и проектам.'
							: 'Открываем ребёнку сильный старт в технологиях.'}
					</h1>
					<p className='brand-lead mt-5'>
						{mode === 'login'
							? 'Войдите в кабинет Progyx и продолжайте путь: теория, практика, квизы, достижения и многое другое уже собраны в одном интерфейсе.'
							: 'Создайте аккаунт, выберите роль и возрастную группу. Дальше платформа сама выстроит путь через уроки, задания, XP и семейный доступ.'}
					</p>

					<div className='mt-6 flex flex-wrap gap-2'>
						<span className='brand-chip'>маршрут по возрасту</span>
						<span className='brand-chip brand-chip--soft'>проекты и квизы</span>
						<span className='brand-chip brand-chip--warm'>
							семейный кабинет
						</span>
					</div>

					<div className='mt-8 grid gap-4 sm:grid-cols-2' data-motion-stagger>
						{infoCards.map(([title, text]) => (
							<article
								key={title}
								className='auth-support-card rounded-[28px] bg-white/90 p-5 shadow-sm'
								data-motion-item
							>
								<p className='text-xs font-bold uppercase tracking-[0.18em] text-sky-700'>
									{title}
								</p>
								<p className='auth-support-copy mt-3 text-sm leading-7 text-slate-600'>
									{text}
								</p>
							</article>
						))}
					</div>

					{/* {mode === 'register' && (
            <div className="auth-process-panel home-code-panel mt-6 p-5 text-white">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100">После регистрации</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-sm font-bold">1. Возрастной маршрут</p>
                  <p className="mt-2 text-sm leading-6 text-sky-50/90">Платформа покажет подходящие модули и уроки.</p>
                </div>
                <div>
                  <p className="text-sm font-bold">2. Рабочий кабинет</p>
                  <p className="mt-2 text-sm leading-6 text-sky-50/90">Ученик увидит следующий шаг, задания и прогресс.</p>
                </div>
                <div>
                  <p className="text-sm font-bold">3. Семейная прозрачность</p>
                  <p className="mt-2 text-sm leading-6 text-sky-50/90">Родитель сможет подключиться по семейной ссылке.</p>
                </div>
              </div>
            </div>
          )} */}
				</section>

				<section
					className='auth-form-panel order-1 codequest-card min-w-0 p-6 sm:p-8 lg:order-2'
					data-motion-hero-visual
				>
					<div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
						<div>
							<Link href='/' className='brand-eyebrow'>
								На сайт
							</Link>
							<h2 className='auth-form-title mt-3 text-3xl font-black leading-tight text-slate-900 sm:text-4xl'>
								{mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'}
							</h2>
							<p className='auth-form-intro mt-3 text-sm leading-7 text-slate-600'>
								{mode === 'login'
									? 'Введите email и продолжайте с того места, где остановились.'
									: isTeacherRegistration
										? 'Заполните профиль учителя. После отправки администратор подтвердит доступ к кабинету.'
										: isParentRegistration
											? 'Создайте семейный кабинет: позже привяжите детей по коду из их учётных записей.'
											: 'Заполните профиль, чтобы открыть свой маршрут внутри платформы.'}
							</p>
						</div>
						<Link
							href={mode === 'login' ? '/auth/register' : '/auth/login'}
							className='auth-switch-button brand-button-secondary w-full sm:w-auto'
						>
							{mode === 'login' ? 'Нет аккаунта' : 'Уже есть аккаунт'}
						</Link>
					</div>

					{notice ? (
						<div className='mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800'>
							{notice}
						</div>
					) : null}

					{unverifiedLoginEmail ? (
						<div className='mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-slate-700'>
							<p className='font-semibold text-slate-900'>Email не подтверждён</p>
							<p className='mt-1'>
								Мы отправили письмо для подтверждения на{' '}
								<span className='font-semibold'>{unverifiedLoginEmail}</span>.
								Откройте письмо и нажмите кнопку «Подтвердить email» — после
								этого можно будет войти.
							</p>
							<div className='mt-4 flex flex-wrap gap-2'>
								<button
									type='button'
									className='brand-button-secondary'
									disabled={resending}
									onClick={handleLoginResendVerification}
								>
									{resending ? 'Отправляем…' : 'Отправить письмо повторно'}
								</button>
							</div>
						</div>
					) : null}

					{postRegisterEmail ? (
						<div className='mt-6 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm leading-6 text-slate-700'>
							<p className='font-semibold text-slate-900'>Проверьте почту</p>
							<p className='mt-1'>
								{postRegisterRole === 'parent' ? (
									<>
										Мы отправили на{' '}
										<span className='font-semibold'>{postRegisterEmail}</span>{' '}
										временный пароль и ссылку для подтверждения email. Сейчас
										вы уже вошли в кабинет — но чтобы привязать ребёнка,
										нужно подтвердить почту, заполнить имя и телефон.
									</>
								) : (
									<>
										Мы отправили письмо на{' '}
										<span className='font-semibold'>{postRegisterEmail}</span>.
										Откройте его, нажмите «Подтвердить email» — и сможете
										войти в кабинет.
									</>
								)}
							</p>
							<div className='mt-4 flex flex-wrap gap-2'>
								<button
									type='button'
									className='brand-button-secondary'
									disabled={resending}
									onClick={async () => {
										setResending(true)
										try {
											await resendVerification(
												postRegisterRole === 'parent'
													? undefined
													: { email: postRegisterEmail },
											)
											setNotice('Письмо отправлено повторно. Проверьте папку «Спам».')
										} catch (resendError) {
											showErrorToast(
												getApiErrorMessage(
													resendError,
													'Не удалось отправить письмо повторно. Попробуйте позже.',
												),
											)
										} finally {
											setResending(false)
										}
									}}
								>
									{resending ? 'Отправляем…' : 'Отправить письмо повторно'}
								</button>
								{postRegisterRole === 'parent' ? (
									<Link
										href='/parent/dashboard'
										className='brand-button-ghost'
									>
										Перейти в кабинет
									</Link>
								) : (
									<Link
										href='/auth/login'
										className='brand-button-ghost'
									>
										На страницу входа
									</Link>
								)}
							</div>
						</div>
					) : null}

					<form className='mt-8 space-y-5' noValidate onSubmit={handleSubmit}>
						{mode === 'register' && !isParentRegistration && (
							<label className='block space-y-2'>
								<span className='auth-label text-sm font-semibold text-slate-700'>
									Имя
								</span>
								<input
									className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
									autoComplete='name'
									value={form.full_name}
									onChange={e =>
										setForm({ ...form, full_name: e.target.value })
									}
								/>
							</label>
						)}

						<div className='grid gap-5 md:grid-cols-2'>
							<label className='space-y-2'>
								<span className='auth-label text-sm font-semibold text-slate-700'>
									Почта
								</span>
								<input
									type={mode === 'login' ? 'text' : 'email'}
									autoComplete={mode === 'login' ? 'email' : 'email'}
									placeholder={
										mode === 'login'
											? 'Введите почту'
											: 'name@example.com'
									}
									className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
									value={form.email}
									onChange={e => setForm({ ...form, email: e.target.value })}
								/>
							</label>

							{mode === 'register' && !isParentRegistration && (
								<label className='space-y-2'>
									<span className='auth-label text-sm font-semibold text-slate-700'>
										Телефон
									</span>
									<input
										type='tel'
										autoComplete='tel'
										inputMode='tel'
										placeholder='+7 912 345-67-89'
										className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
										value={form.phone}
										onChange={e =>
											setForm({ ...form, phone: e.target.value })
										}
									/>
								</label>
							)}

							{mode === 'register' && (
								<label className='space-y-2 md:col-span-2'>
									<span className='auth-label text-sm font-semibold text-slate-700'>
										Роль
									</span>
									<select
										className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
										value={form.role}
										onChange={e => {
											setNotice(null)
											setForm({ ...form, role: e.target.value })
										}}
									>
										{(options?.roles?.length
											? options.roles
											: ['student', 'teacher']
										).map(role => (
											<option key={role} value={role}>
												{roleLabel(role)}
											</option>
										))}
									</select>
								</label>
							)}
						</div>

						{isParentRegistration ? (
							<div className='rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-slate-700'>
								<p className='font-semibold text-slate-900'>Только email</p>
								<p className='mt-1'>
									Для семейного кабинета достаточно почты. Мы пришлём временный
									пароль и ссылку для подтверждения email одним письмом.
									Имя и телефон вы заполните позже — они нужны только для
									привязки ребёнка.
								</p>
							</div>
						) : (
							<label className='space-y-2'>
								<span className='auth-label text-sm font-semibold text-slate-700'>
									Пароль
								</span>
								<div className='auth-password-shell flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3'>
									<input
										className='auth-password-input w-full bg-transparent'
										type={showPassword ? 'text' : 'password'}
										autoComplete={
											mode === 'login' ? 'current-password' : 'new-password'
										}
										value={form.password}
										onChange={e => setForm({ ...form, password: e.target.value })}
									/>
									<button
										type='button'
										className='auth-password-toggle shrink-0 text-sm font-semibold text-sky-700'
										onClick={() => setShowPassword(item => !item)}
									>
										{showPassword ? 'Скрыть' : 'Показать'}
									</button>
								</div>
								{mode === 'register' && (
									<div className='auth-helper grid gap-1 text-sm text-slate-500'>
										<p>
											Надёжность пароля:{' '}
											<span className='font-semibold text-slate-900'>
												{strength}
											</span>
										</p>
										<p>
											Минимум 10 символов: строчные и заглавные буквы, цифра,
											спецсимвол, без пробелов.
										</p>
									</div>
								)}
								{mode === 'login' && (
									<div className='flex justify-end'>
										<Link
											href='/forgot-password'
											className='text-sm font-semibold text-sky-700 hover:underline'
										>
											Забыли пароль?
										</Link>
									</div>
								)}
							</label>
						)}

						{mode === 'register' && !isTeacherRegistration && !isParentRegistration && (
							<label className='space-y-2'>
								<span className='auth-label text-sm font-semibold text-slate-700'>
									Возрастная группа
								</span>
								<select
									className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
									value={form.age_group}
									onChange={e =>
										setForm({ ...form, age_group: e.target.value })
									}
								>
									{(options?.age_groups || ['junior', 'middle', 'senior']).map(
										ageGroup => (
											<option key={ageGroup} value={ageGroup}>
												{ageGroup === 'junior'
													? 'Младшая 7–10'
													: ageGroup === 'middle'
														? 'Средняя 11–13'
														: 'Старшая 14–15'}
											</option>
										),
									)}
								</select>
							</label>
						)}

						<button
							disabled={loading}
							className='auth-submit-button brand-button-primary mt-2 w-full'
						>
							{loading
								? 'Подождите…'
								: mode === 'login'
									? 'Войти в кабинет'
									: isTeacherRegistration
										? 'Отправить заявку'
										: isParentRegistration
											? 'Создать семейный кабинет'
											: 'Создать аккаунт'}
						</button>
					</form>
				</section>
			</div>
		</main>
	)
}
