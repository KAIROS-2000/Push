'use client'

import { ThemeToggleButton } from '@/components/theme-toggle-button'
import { api } from '@/lib/api'
import { useSessionUser } from '@/lib/auth-session'
import { setAnonymousSession } from '@/lib/session-store'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'

type UserRole = 'student' | 'teacher' | 'admin' | 'superadmin'
type HeaderZone = 'teacher' | 'public' | 'app' | 'parent' | 'admin'

const roleSet = new Set<UserRole>(['student', 'teacher', 'admin', 'superadmin'])

function resolveHeaderZone(pathname: string | null): HeaderZone {
	if (pathname?.startsWith('/teacher')) return 'teacher'
	if (pathname?.startsWith('/admin') || pathname?.startsWith('/superadmin'))
		return 'admin'
	if (pathname?.startsWith('/parent/')) return 'parent'
	if (pathname === '/' || pathname === '/parent') return 'public'
	return 'app'
}

export function SiteHeader() {
	const pathname = usePathname()
	const zone = resolveHeaderZone(pathname)
	const { user } = useSessionUser({ auth: 'optional' })

	const role = useMemo<UserRole | null>(() => {
		const value = user?.role
		return value && roleSet.has(value as UserRole) ? (value as UserRole) : null
	}, [user])

	const isAuthenticated = Boolean(user)

	function handleLogout() {
		const confirmed = window.confirm(
			'Вы уверены, что хотите выйти из учетной записи?',
		)
		if (!confirmed) return

		void api('/auth/logout', { method: 'POST' }, 'required')
			.catch(() => undefined)
			.finally(() => {
				setAnonymousSession()
				window.location.href = '/auth/login'
			})
	}

	const links = useMemo(() => {
		if (!isAuthenticated) {
			return zone === 'public'
				? [
						{ href: '/', label: 'Главная' },
						{ href: '/parent', label: 'Родителям' },
					]
				: [{ href: '/', label: 'Главная' }]
		}

		const secured = [
			{ href: '/dashboard', label: 'Кабинет' },
			{ href: '/messages', label: 'Сообщения' },
			{ href: '/roadmap', label: 'Уроки' },
			{ href: '/leaderboard', label: 'Рейтинг' },
			{ href: '/profile', label: 'Профиль' },
		]

		// if (role === 'admin' || role === 'superadmin') {
		// 	return [
		// 		{ href: '/admin', label: 'Админ' },
		// 		...(role === 'superadmin'
		// 			? [{ href: '/superadmin', label: 'Суперадмин' }]
		// 			: []),
		// 		{ href: '/roadmap', label: 'Уроки' },
		// 		{ href: '/profile', label: 'Профиль' },
		// 	]
		// }

		if (role === 'admin') {
			return [
				{ href: '/admin/users', label: 'Админ' },
				{ href: '/roadmap', label: 'Уроки' },
				{ href: '/profile', label: 'Профиль' },
			]
		} else if (role === 'superadmin') {
			return [
				{ href: '/superadmin/users', label: 'Суперадмин' },
				{ href: '/roadmap', label: 'Уроки' },
				{ href: '/profile', label: 'Профиль' },
			]
		} else if (role === 'teacher') {
			return [
				{ href: '/dashboard', label: 'Кабинет' },
				{ href: '/teacher', label: 'Учитель' },
				{ href: '/messages', label: 'Сообщения' },
				{ href: '/roadmap', label: 'Уроки' },
				{ href: '/leaderboard', label: 'Рейтинг' },
				{ href: '/profile', label: 'Профиль' },
			]
		}

		if (zone === 'parent') {
			return [
				{ href: '/', label: 'Главная' },
				{ href: '/dashboard', label: 'Кабинет ученика' },
			]
		}

		return secured
	}, [isAuthenticated, role, zone])

	// const metaLabel =
	//   zone === 'public'
	//     ? '7–15 лет · проекты · уроки'
	//     : zone === 'parent'
	//       ? 'спокойный доступ для семьи'
	//       : zone === 'admin'
	//         ? 'контент · публикация · роли'
	//         : role === 'student'
	//           ? 'уроки · XP · задания'
	//           : 'единый кабинет'

	// const brandSubtitle =
	// 	zone === 'public'
	// 		? 'IT-школа с понятным маршрутом для детей и родителей'
	// 		: zone === 'parent'
	// 			? 'Семейный обзор прогресса и модулей'
	// 			: zone === 'admin'
	// 				? 'Рабочая панель платформы'
	// 				: 'Личный кабинет ученика'

	return (
		<header
			className={`progyx-header ${zone === 'public' ? 'progyx-header--public' : 'progyx-header--app'}`}
		>
			<div className='progyx-header__shell'>
				<Link
					href='/'
					className={`progyx-header__brand ${isAuthenticated ? 'progyx-header__brand--auth' : ''}`}
				>
					<Image
						src='/progyx-logo.png'
						alt='Логотип Progyx'
						width={80}
						height={80}
						className='h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16'
						priority
					/>
					<div className='progyx-header__brand-copy'>
						<span className='progyx-header__brand-tag'>Progyx</span>
						<p className='progyx-header__brand-title'>
							Образовательная платформа
						</p>
						{/* <p className='progyx-header__brand-subtitle'>{brandSubtitle}</p> */}
					</div>
				</Link>

				<nav className='progyx-header__nav'>
					{links.map(link => {
						const isActive =
							pathname === link.href ||
							(link.href !== '/' && pathname?.startsWith(link.href))
						return (
							<Link
								key={link.href}
								href={link.href}
								className={`progyx-header__link ${isActive ? 'progyx-header__link--active' : ''}`}
							>
								{link.label}
							</Link>
						)
					})}
				</nav>

				<div
					className={`progyx-header__actions ${isAuthenticated ? 'progyx-header__actions--auth' : 'progyx-header__actions--guest'}`}
				>
					{/* <span className='progyx-header__signal'>{metaLabel}</span> */}
					<ThemeToggleButton user={user} />
					{isAuthenticated ? (
						<button
							className='progyx-header__button progyx-header__button--primary progyx-header__button--desktop-auth'
							onClick={handleLogout}
						>
							Выйти
						</button>
					) : (
						<>
							<Link
								href='/auth/login'
								className='progyx-header__button progyx-header__button--ghost'
							>
								Войти
							</Link>
							<Link
								href='/auth/register'
								className='progyx-header__button progyx-header__button--primary'
							>
								Создать аккаунт
							</Link>
						</>
					)}
				</div>
			</div>
		</header>
	)
}
