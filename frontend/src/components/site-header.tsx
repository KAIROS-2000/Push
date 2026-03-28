'use client'

import { clearTokens, getAccessToken } from '@/lib/storage'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type UserRole = 'student' | 'teacher' | 'admin' | 'superadmin'

const roleSet = new Set<UserRole>(['student', 'teacher', 'admin', 'superadmin'])

function parseRoleFromToken(token: string): UserRole | null {
	const parts = token.split('.')
	if (parts.length !== 3) return null
	const payloadPart = parts[1]
	if (!payloadPart) return null
	try {
		const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
		const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
		const payload = JSON.parse(atob(normalized + padding)) as { role?: string }
		if (payload.role && roleSet.has(payload.role as UserRole)) {
			return payload.role as UserRole
		}
	} catch {
		return null
	}
	return null
}

export function SiteHeader() {
	const pathname = usePathname()
	const [token, setToken] = useState('')

	useEffect(() => {
		setToken(getAccessToken())
	}, [pathname])

	const role = useMemo(() => parseRoleFromToken(token), [token])
	const isAuthenticated = Boolean(token)
	const links = useMemo(() => {
		const common = [
			{ href: '/', label: 'Главная' },
			{ href: '/parent', label: 'Родители' },
		]
		if (!isAuthenticated) return common

		const secured = [
			{ href: '/dashboard', label: 'Кабинет' },
			{ href: '/roadmap', label: 'Roadmap' },
			{ href: '/leaderboard', label: 'Рейтинг' },
			{ href: '/profile', label: 'Профиль' },
		]

		if (role === 'teacher')
			secured.splice(3, 0, { href: '/teacher', label: 'Учитель' })
		if (role === 'admin' || role === 'superadmin')
			secured.splice(3, 0, { href: '/admin', label: 'Админ' })
		if (role === 'superadmin')
			secured.splice(4, 0, { href: '/superadmin', label: 'Суперадмин' })

		return [...common, ...secured]
	}, [isAuthenticated, role])

	return (
		<header className='sticky top-0 z-50 overflow-x-clip border-b border-white/60 bg-white/70 backdrop-blur-xl'>
			<div className='site-header-shell mx-auto flex max-w-7xl flex-col gap-3 px-4 pb-3 pt-2 sm:px-6 sm:pb-4 sm:pt-3 lg:flex-row lg:flex-wrap lg:items-center'>
				<Link
					href='/'
					className='flex min-w-0 items-center gap-3 lg:basis-auto lg:flex-none'
				>
					<div className='flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white shadow-lg shadow-sky-200 ring-1 ring-sky-100'>
						<Image
							src='/kodiums-logo.png'
							alt='Логотип Кодиумс'
							width={44}
							height={44}
							className='h-11 w-11 rounded-full object-cover'
							priority
						/>
					</div>
					<div className='min-w-0'>
						<p className='text-[9px] font-bold uppercase tracking-[0.24em] text-sky-600 sm:text-xs'>
							Кодиумс
						</p>
						<h1 className='truncate text-sm font-black text-slate-900 sm:text-lg'>
							Обучающая платформа
						</h1>
					</div>
				</Link>

				<nav className='order-3 grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:order-none lg:flex lg:w-auto lg:flex-1 lg:flex-wrap lg:justify-center lg:gap-3'>
					{links.map(link => {
						const isActive =
							pathname === link.href ||
							(link.href !== '/' && pathname?.startsWith(link.href))
						return (
							<Link
								key={link.href}
								href={link.href}
								className={`min-w-0 rounded-full px-3 py-2 text-center text-xs font-semibold transition sm:px-4 sm:text-sm ${
									isActive
										? 'bg-slate-900 text-white'
										: 'bg-white text-slate-700 shadow-sm'
								}`}
							>
								{link.label}
							</Link>
						)
					})}
				</nav>

				<div className='order-2 flex w-full flex-wrap items-center justify-stretch gap-2 lg:ml-auto lg:w-auto lg:justify-end lg:gap-3'>
					{isAuthenticated ? (
						<button
							className='inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:flex-none'
							onClick={() => {
								clearTokens()
								window.location.href = '/auth/login'
							}}
						>
							Выйти
						</button>
					) : (
						<>
							<Link
								href='/auth/login'
								className='inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm sm:flex-none'
							>
								Войти
							</Link>
							<Link
								href='/auth/register'
								className='inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:flex-none'
							>
								Регистрация
							</Link>
						</>
					)}
				</div>
			</div>
		</header>
	)
}
