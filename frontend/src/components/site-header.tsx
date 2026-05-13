'use client'

import { ThemeToggleButton } from '@/components/theme-toggle-button'
import { api } from '@/lib/api'
import { useSessionUser } from '@/lib/auth-session'
import { setAnonymousSession } from '@/lib/session-store'
import { Menu, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type TouchEvent as ReactTouchEvent,
} from 'react'
import { createPortal } from 'react-dom'

type UserRole = 'student' | 'teacher' | 'parent' | 'admin' | 'superadmin'
type HeaderZone = 'teacher' | 'public' | 'app' | 'parent' | 'admin'

const roleSet = new Set<UserRole>(['student', 'teacher', 'parent', 'admin', 'superadmin'])

function resolveHeaderZone(pathname: string | null): HeaderZone {
	if (pathname?.startsWith('/teacher')) return 'teacher'
	if (pathname?.startsWith('/admin') || pathname?.startsWith('/superadmin'))
		return 'admin'
	if (pathname?.startsWith('/parent/') || pathname === '/parent') return 'parent'
	if (pathname === '/' || pathname === '/tournament' || pathname === '/it-career')
		return 'public'
	return 'app'
}

type NavLink = { href: string; label: string }

function isCabinetLink(link: NavLink) {
	if (
		link.href === '/dashboard' ||
		link.href === '/parent/dashboard' ||
		link.href.startsWith('/admin') ||
		link.href.startsWith('/superadmin')
	)
		return true
	if (/кабинет/i.test(link.label)) return true
	if (link.label === 'Админ' || link.label === 'Суперадмин') return true
	return false
}

function isLessonsLink(link: NavLink) {
	return link.href === '/roadmap' || link.label === 'Уроки'
}

/** «Кабинет» + «Уроки» в компактной шапке; остальное — в выезжающем меню. */
function splitMobileNavLinks(links: NavLink[]): {
	primary: NavLink[]
	overflow: NavLink[]
} {
	const home = links.find(link => link.href === '/')
	const career = links.find(link => link.href === '/it-career')
	if (home && career) {
		const primary = [home, career]
		const primaryHrefs = new Set(primary.map(link => link.href))
		return {
			primary,
			overflow: links.filter(link => !primaryHrefs.has(link.href)),
		}
	}

	const cabinet = links.find(isCabinetLink)
	const lessons = links.find(isLessonsLink)

	if (!cabinet && !lessons) {
		if (links.length > 3) {
			return { primary: links.slice(0, 3), overflow: links.slice(3) }
		}
		return { primary: links, overflow: [] }
	}

	const primary: NavLink[] = []
	if (cabinet) primary.push(cabinet)
	if (lessons && lessons.href !== cabinet?.href) primary.push(lessons)

	const primaryHrefs = new Set(primary.map(p => p.href))
	const overflow = links.filter(l => !primaryHrefs.has(l.href))

	if (overflow.length === 0) {
		return { primary: links, overflow: [] }
	}

	return { primary, overflow }
}

const MOBILE_NAV_MQ = '(max-width: 767px)'

function subscribeMobileNavMq(onChange: () => void) {
	if (typeof window === 'undefined') return () => {}
	const mq = window.matchMedia(MOBILE_NAV_MQ)
	mq.addEventListener('change', onChange)
	return () => mq.removeEventListener('change', onChange)
}

function getMobileNavSnapshot() {
	if (typeof window === 'undefined') return false
	return window.matchMedia(MOBILE_NAV_MQ).matches
}

function getMobileNavServerSnapshot() {
	return false
}

function useMobileNavLayout() {
	return useSyncExternalStore(
		subscribeMobileNavMq,
		getMobileNavSnapshot,
		getMobileNavServerSnapshot,
	)
}

export function SiteHeader() {
	const pathname = usePathname()
	const zone = resolveHeaderZone(pathname)
	const { user } = useSessionUser({ auth: 'optional' })
	const isMobileNav = useMobileNavLayout()
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const [drawerPortalReady, setDrawerPortalReady] = useState(false)
	const openEdgeSwipeRef = useRef<{
		startX: number
		startY: number
		active: boolean
	} | null>(null)
	const closeSwipeRef = useRef<{
		startX: number
		startY: number
	} | null>(null)
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
		// Header keeps only the primary tools per role. Secondary destinations
		// (Турнир, Полезное, Рейтинг) live in the footer navigation so the
		// header stays compact and readable on narrow screens.
		if (!isAuthenticated) {
			if (zone === 'parent') {
				return [
					{ href: '/', label: 'Главная' },
					{ href: '/it-career', label: 'Карьера IT' },
					{ href: '/parent', label: 'Родителям' },
					{ href: '/auth/register', label: 'Регистрация' },
				]
			}
			return [
				{ href: '/', label: 'Главная' },
				{ href: '/it-career', label: 'Карьера IT' },
				{ href: '/parent', label: 'Родителям' },
			]
		}

		// Default learner ("student") set — Турнир/Полезное/Рейтинг переехали в футер.
		const secured = [
			{ href: '/dashboard', label: 'Кабинет' },
			{ href: '/roadmap', label: 'Уроки' },
			{ href: '/messages', label: 'Сообщения' },
			{ href: '/profile', label: 'Профиль' },
		]

		if (role === 'admin') {
			return [
				{ href: '/admin/users', label: 'Админ' },
				{ href: '/admin/messages', label: 'Сообщения' },
				{ href: '/admin/logs', label: 'Логи' },
				{ href: '/profile', label: 'Профиль' },
			]
		} else if (role === 'superadmin') {
			return [
				{ href: '/superadmin/users', label: 'Суперадмин' },
				{ href: '/superadmin/messages', label: 'Сообщения' },
				{ href: '/superadmin/logs', label: 'Логи' },
				{ href: '/profile', label: 'Профиль' },
			]
		} else if (role === 'teacher') {
			return [
				{ href: '/dashboard', label: 'Кабинет' },
				{ href: '/teacher', label: 'Учитель' },
				{ href: '/messages', label: 'Сообщения' },
				{ href: '/roadmap', label: 'Уроки' },
				{ href: '/profile', label: 'Профиль' },
			]
		}

		if (role === 'parent') {
			// Per product brief: parent header — без Турнира и Полезного;
			// эти разделы доступны через футер.
			return [
				{ href: '/parent/dashboard', label: 'Семейный кабинет' },
				{ href: '/roadmap', label: 'Уроки' },
				{ href: '/messages', label: 'Сообщения' },
				{ href: '/profile', label: 'Профиль' },
			]
		}

		if (zone === 'parent' && role === 'student') {
			return [
				{ href: '/', label: 'Главная' },
				{ href: '/dashboard', label: 'Кабинет ученика' },
			]
		}

		return secured
	}, [isAuthenticated, role, zone])

	const { primary: mobilePrimaryLinks, overflow: mobileOverflowLinks } =
		useMemo(() => splitMobileNavLinks(links), [links])

	const useMobileDrawer =
		isMobileNav &&
		mobileOverflowLinks.length > 0 &&
		mobilePrimaryLinks.length > 0

	const navLinks = useMobileDrawer ? mobilePrimaryLinks : links

	useEffect(() => {
		setDrawerPortalReady(true)
	}, [])

	useEffect(() => {
		setSidebarOpen(false)
	}, [pathname])

	useEffect(() => {
		if (!sidebarOpen) return
		const prev = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.body.style.overflow = prev
		}
	}, [sidebarOpen])

	useEffect(() => {
		if (!sidebarOpen) return
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') setSidebarOpen(false)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [sidebarOpen])

	useEffect(() => {
		if (!useMobileDrawer || sidebarOpen) return

		const edgePx = 44

		function onTouchStart(e: TouchEvent) {
			if (e.touches.length !== 1) return
			const t = e.touches[0]
			if (t.clientX < window.innerWidth - edgePx) return
			openEdgeSwipeRef.current = {
				startX: t.clientX,
				startY: t.clientY,
				active: true,
			}
		}

		function onTouchMove(e: TouchEvent) {
			const s = openEdgeSwipeRef.current
			if (!s?.active || e.touches.length !== 1) return
			const t = e.touches[0]
			if (Math.abs(t.clientY - s.startY) > 55) {
				s.active = false
			}
		}

		function onTouchEnd(e: TouchEvent) {
			const s = openEdgeSwipeRef.current
			openEdgeSwipeRef.current = null
			if (!s?.active || e.changedTouches.length !== 1) return
			const t = e.changedTouches[0]
			const dx = t.clientX - s.startX
			const dy = Math.abs(t.clientY - s.startY)
			if (dx < -64 && dy < 72) setSidebarOpen(true)
		}

		document.addEventListener('touchstart', onTouchStart, { passive: true })
		document.addEventListener('touchmove', onTouchMove, { passive: true })
		document.addEventListener('touchend', onTouchEnd, { passive: true })
		return () => {
			document.removeEventListener('touchstart', onTouchStart)
			document.removeEventListener('touchmove', onTouchMove)
			document.removeEventListener('touchend', onTouchEnd)
		}
	}, [useMobileDrawer, sidebarOpen])

	const onSidebarTouchStart = useCallback((e: ReactTouchEvent) => {
		if (e.touches.length !== 1) return
		const t = e.touches[0]
		closeSwipeRef.current = { startX: t.clientX, startY: t.clientY }
	}, [])

	const onSidebarTouchEnd = useCallback((e: ReactTouchEvent) => {
		const s = closeSwipeRef.current
		closeSwipeRef.current = null
		if (!s || e.changedTouches.length !== 1) return
		const t = e.changedTouches[0]
		const dx = t.clientX - s.startX
		const dy = Math.abs(t.clientY - s.startY)
		if (dx > 56 && dy < 80) setSidebarOpen(false)
	}, [])

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

	function renderNavLink(link: NavLink) {
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
	}

	return (
		<header
			className={`progyx-header ${zone === 'public' ? 'progyx-header--public' : 'progyx-header--app'} ${useMobileDrawer ? 'progyx-header--mobile-drawer' : ''}`}
		>
			<div
				className={`progyx-header__shell ${useMobileDrawer ? 'progyx-header__shell--mobile-drawer' : ''}`}
			>
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

				<nav
					className={`progyx-header__nav ${useMobileDrawer ? 'progyx-header__nav--compact' : ''}`}
					aria-label='Основная навигация'
				>
					{navLinks.map(renderNavLink)}
				</nav>

				<div
					className={`progyx-header__actions ${isAuthenticated ? 'progyx-header__actions--auth' : 'progyx-header__actions--guest'} ${useMobileDrawer ? 'progyx-header__actions--with-menu' : ''}`}
				>
					{useMobileDrawer ? (
						<button
							type='button'
							className='progyx-header__icon-button progyx-header__icon-button--menu'
							aria-label='Открыть меню'
							aria-expanded={sidebarOpen}
							aria-controls='site-header-mobile-drawer'
							onClick={() => setSidebarOpen(true)}
						>
							<Menu className='progyx-header__icon-button-svg' strokeWidth={2.25} />
						</button>
					) : null}
					{/* <span className='progyx-header__signal'>{metaLabel}</span> */}
					<ThemeToggleButton user={user} />
					{isAuthenticated ? (
						<button
							className='progyx-header__button progyx-header__button--primary progyx-header__button--desktop-auth'
							onClick={handleLogout}
						>
							Выйти
						</button>
					) : null}
				</div>
				{!isAuthenticated ? (
					<div className='progyx-header__guest-auth'>
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
							<span className='progyx-header__button-label progyx-header__button-label--full'>
								Создать аккаунт
							</span>
							<span className='progyx-header__button-label progyx-header__button-label--short'>
								Регистрация
							</span>
						</Link>
					</div>
				) : null}
			</div>

			{drawerPortalReady && useMobileDrawer
				? createPortal(
						<>
							<div
								className={`progyx-header__sidebar-backdrop ${sidebarOpen ? 'progyx-header__sidebar-backdrop--open' : ''}`}
								aria-hidden={!sidebarOpen}
								onClick={() => setSidebarOpen(false)}
								onTouchStart={onSidebarTouchStart}
								onTouchEnd={onSidebarTouchEnd}
							/>
							<aside
								id='site-header-mobile-drawer'
								className={`progyx-header__sidebar-panel ${sidebarOpen ? 'progyx-header__sidebar-panel--open' : ''}`}
								aria-hidden={!sidebarOpen}
								onTouchStart={onSidebarTouchStart}
								onTouchEnd={onSidebarTouchEnd}
							>
								<div className='progyx-header__sidebar-head'>
									<p className='progyx-header__sidebar-title'>Разделы</p>
									<button
										type='button'
										className='progyx-header__icon-button progyx-header__icon-button--close'
										aria-label='Закрыть меню'
										onClick={() => setSidebarOpen(false)}
									>
										<X className='progyx-header__icon-button-svg' strokeWidth={2.25} />
									</button>
								</div>
								<nav
									className='progyx-header__sidebar-nav'
									aria-label='Дополнительная навигация'
								>
									{mobileOverflowLinks.map(link => {
										const isActive =
											pathname === link.href ||
											(link.href !== '/' &&
												pathname?.startsWith(link.href))
										return (
											<Link
												key={link.href}
												href={link.href}
												className={`progyx-header__sidebar-link ${isActive ? 'progyx-header__sidebar-link--active' : ''}`}
												onClick={() => setSidebarOpen(false)}
											>
												{link.label}
											</Link>
										)
									})}
								</nav>
								{isAuthenticated ? (
									<div className='progyx-header__sidebar-foot'>
										<button
											type='button'
											className='progyx-header__sidebar-logout'
											onClick={() => {
												setSidebarOpen(false)
												handleLogout()
											}}
										>
											Выйти
										</button>
									</div>
								) : null}
							</aside>
						</>,
						document.body,
					)
				: null}
		</header>
	)
}
