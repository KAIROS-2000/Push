'use client'

import Link from 'next/link'
import { useSessionUser } from '@/lib/auth-session'

export function SiteFooter({
	showRegisterLink = true,
}: {
	showRegisterLink?: boolean
}) {
	const { status } = useSessionUser({ auth: 'optional' })
	const shouldShowRegisterLink =
		showRegisterLink && status === 'anonymous'

	const links = [
		{ href: '/', label: 'Главная' },
		{ href: '/parent', label: 'Родителям' },
		...(shouldShowRegisterLink
			? [{ href: '/auth/register', label: 'Создать аккаунт' }]
			: []),
	]

	return (
		<footer className='site-footer' data-motion-reveal>
			<div className='site-footer__shell'>
				<div className='site-footer__grid'>
					<div className='space-y-4'>
						<p className='brand-eyebrow'>Progyx</p>
						<h2 className='site-footer__title'>
							Маршрут, урок и прогресс в одном спокойном интерфейсе.
						</h2>
						<p className='site-footer__note'>
							Для ребёнка это понятный путь. Для семьи это прозрачная динамика
							без лишней сложности.
						</p>
					</div>
					<div className='site-footer__links' data-motion-stagger>
						{links.map(link => (
							<Link
								key={link.href}
								href={link.href}
								className='site-footer__link'
								data-motion-item
							>
								{link.label}
							</Link>
						))}
					</div>
				</div>
			</div>
		</footer>
	)
}
