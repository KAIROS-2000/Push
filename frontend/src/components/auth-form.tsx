'use client'

import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { api } from '@/lib/api'
import { queueMascotScenario } from '@/lib/mascot'
import { setAuthenticatedSession } from '@/lib/session-store'
import { setTheme } from '@/lib/theme'
import { showErrorToast } from '@/lib/toast'
import { AuthOptions, UserItem } from '@/types'
import Image from 'next/image'
import Link from 'next/link'
import { FormEvent, useMemo, useRef, useState } from 'react'

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const PASSWORD_WHITESPACE_RE = /\s/
const USERNAME_MAX_LENGTH = 10

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
	return role === 'teacher' ? 'Учитель' : 'Ученик'
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
	const [form, setForm] = useState({
		full_name: '',
		username: '',
		email: '',
		password: '',
		role: 'student',
		age_group: 'middle',
		theme: 'light' as UserItem['theme'],
	})

	const isTeacherRegistration = mode === 'register' && form.role === 'teacher'
	const strength = useMemo(() => strengthLabel(form.password), [form.password])

	useUserPageMotion(rootRef, [mode, isTeacherRegistration, strength])

	async function handleSubmit(event: FormEvent) {
		event.preventDefault()
		const normalizedCredential = form.email.trim().toLowerCase()
		const normalizedUsername = form.username.trim()
		if (mode === 'register' && !isValidEmail(normalizedCredential)) {
			showErrorToast('Укажите корректный email.')
			return
		}
		if (
			mode === 'register'
			&& normalizedUsername.length > USERNAME_MAX_LENGTH
		) {
			showErrorToast(
				`Логин должен содержать не более ${USERNAME_MAX_LENGTH} символов.`,
			)
			return
		}
		if (mode === 'register' && form.password.length < 10) {
			showErrorToast('Пароль должен содержать не менее 10 символов.')
			return
		}
		if (mode === 'register' && hasPasswordWhitespace(form.password)) {
			showErrorToast('Пароль не должен содержать пробелы.')
			return
		}
		if (mode === 'register' && !isTeacherRegistration && !form.age_group) {
			showErrorToast('Выберите возрастную группу ученика.')
			return
		}
		if (mode === 'login' && !normalizedCredential) {
			showErrorToast('Укажите email или username.')
			return
		}

		setLoading(true)

		try {
			const payload =
				mode === 'login'
					? { login: normalizedCredential, password: form.password }
					: {
							full_name: form.full_name,
							username: normalizedUsername,
							email: normalizedCredential,
							password: form.password,
							role: form.role,
							theme: form.theme,
							...(isTeacherRegistration ? {} : { age_group: form.age_group }),
						}

			const result = await api<{ user: UserItem }>('/auth/' + mode, {
				method: 'POST',
				body: JSON.stringify(payload),
			})
			setAuthenticatedSession(result.user)
			setTheme(result.user?.theme || form.theme)
			if (mode === 'register' && result.user?.role === 'student') {
				queueMascotScenario('post_register_intro')
			}
			window.location.href = '/dashboard'
		} catch (e) {
			showErrorToast(
				e instanceof Error ? e.message : 'Не удалось выполнить действие',
			)
		} finally {
			setLoading(false)
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
									? 'Введите email или username и продолжайте с того места, где остановились.'
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

					<form className='mt-8 space-y-5' onSubmit={handleSubmit}>
						{mode === 'register' && (
							<div className='grid gap-5 md:grid-cols-2'>
								<label className='space-y-2'>
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
								<label className='space-y-2'>
									<span className='auth-label text-sm font-semibold text-slate-700'>
										Username
									</span>
									<input
										className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
										autoComplete='username'
										maxLength={USERNAME_MAX_LENGTH}
										value={form.username}
										onChange={e =>
											setForm({
												...form,
												username: e.target.value.slice(0, USERNAME_MAX_LENGTH),
											})
										}
									/>
								</label>
							</div>
						)}

						<div className='grid gap-5 md:grid-cols-2'>
							<label className='space-y-2'>
								<span className='auth-label text-sm font-semibold text-slate-700'>
									{mode === 'login' ? 'Почта или Логин' : 'Почта'}
								</span>
								<input
									type={mode === 'login' ? 'text' : 'email'}
									autoComplete={mode === 'login' ? 'username' : 'email'}
									placeholder={
										mode === 'login'
											? 'Введите почту или логин'
											: 'name@example.com'
									}
									className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
									value={form.email}
									onChange={e => setForm({ ...form, email: e.target.value })}
								/>
							</label>

							{mode === 'register' && (
								<label className='space-y-2'>
									<span className='auth-label text-sm font-semibold text-slate-700'>
										Роль
									</span>
									<select
										className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
										value={form.role}
										onChange={e => setForm({ ...form, role: e.target.value })}
									>
										{options?.roles?.map(role => (
											<option key={role} value={role}>
												{roleLabel(role)}
											</option>
										))}
									</select>
								</label>
							)}
						</div>

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
						</label>

						{mode === 'register' && !isTeacherRegistration && (
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
									: 'Создать аккаунт'}
						</button>
					</form>
				</section>
			</div>
		</main>
	)
}
