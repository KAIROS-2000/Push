'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Mail, MapPin, Phone } from 'lucide-react'
import { useSessionUser } from '@/lib/auth-session'

/** Временные заглушки для юридических и контактных данных — замените на реальные. */
export const SITE_LEGAL_STUBS = {
	supportEmail: 'support@progyx.example',
	phone: '+7 (000) 000-00-00',
	phoneTel: '+70000000000',
	ipName: 'ИП Иванов Иван Иванович',
	inn: '000000000000',
	ogrnip: '000000000000000',
	legalAddress: 'г. Москва, ул. Примерная, д. 1, офис 1 (заглушка)',
} as const

export function SiteFooter({
	showRegisterLink = true,
}: {
	showRegisterLink?: boolean
}) {
	const pathname = usePathname()
	const { status } = useSessionUser({ auth: 'optional' })
	/** Страницы, где не показываем ссылку регистрации в футере (как раньше на /tournament). */
	const suppressRegister = pathname?.startsWith('/tournament') ?? false
	const shouldShowRegisterLink =
		showRegisterLink && status === 'anonymous' && !suppressRegister

	const navLinks = [
		{ href: '/', label: 'Главная' },
		{ href: '/it-career', label: 'Перспективы IT' },
		{ href: '/parent', label: 'Родителям' },
		{ href: '/useful', label: 'Полезные задания' },
		{ href: '/leaderboard', label: 'Рейтинг' },
		{ href: '/support', label: 'Поддержка' },
		...(shouldShowRegisterLink
			? [{ href: '/auth/register', label: 'Создать аккаунт' }]
			: []),
	]

	const docLinks = [
		{ href: '#', label: 'Политика конфиденциальности (заглушка)' },
		{ href: '#', label: 'Пользовательское соглашение (заглушка)' },
		{ href: '#', label: 'Обработка персональных данных (заглушка)' },
	]

	return (
		<footer className='site-footer' data-motion-reveal>
			<div className='site-footer__shell'>
				<div className='site-footer__grid--main'>
					<div className='site-footer__intro space-y-4'>
						<p className='brand-eyebrow'>Progyx</p>
						<h2 className='site-footer__title'>
							Маршрут, урок и прогресс в одном спокойном интерфейсе.
						</h2>
						<p className='site-footer__note'>
							Для ребёнка это понятный путь. Для семьи это прозрачная динамика
							без лишней сложности.
						</p>
					</div>

					<div className='site-footer__column'>
						<p className='site-footer__column-title'>Навигация</p>
						<nav className='site-footer__stack' aria-label='Разделы сайта'>
							{navLinks.map(link => (
								<Link key={link.href} href={link.href} className='site-footer__text-link'>
									{link.label}
								</Link>
							))}
						</nav>
					</div>

					<div className='site-footer__column'>
						<p className='site-footer__column-title'>Контакты</p>
						<ul className='site-footer__contact-list'>
							<li>
								<a
									className='site-footer__contact-line'
									href={`mailto:${SITE_LEGAL_STUBS.supportEmail}`}
								>
									<Mail className='site-footer__contact-icon' aria-hidden />
									<span>{SITE_LEGAL_STUBS.supportEmail}</span>
								</a>
							</li>
							<li>
								<a
									className='site-footer__contact-line'
									href={`tel:${SITE_LEGAL_STUBS.phoneTel}`}
								>
									<Phone className='site-footer__contact-icon' aria-hidden />
									<span>{SITE_LEGAL_STUBS.phone}</span>
								</a>
							</li>
							<li>
								<span className='site-footer__contact-line site-footer__contact-line--static'>
									<MapPin className='site-footer__contact-icon' aria-hidden />
									<span>{SITE_LEGAL_STUBS.legalAddress}</span>
								</span>
							</li>
						</ul>
					</div>

					<div className='site-footer__column'>
						<p className='site-footer__column-title'>Документы</p>
						<nav className='site-footer__stack' aria-label='Правовая информация'>
							{docLinks.map(link => (
								<Link key={link.label} href={link.href} className='site-footer__text-link'>
									{link.label}
								</Link>
							))}
						</nav>
					</div>
				</div>

				<div className='site-footer__legal-block' role='region' aria-label='Реквизиты организации'>
					<p className='site-footer__legal-title'>Сведения об индивидуальном предпринимателе (заглушка)</p>
					<dl className='site-footer__legal-dl'>
						<div>
							<dt>Наименование</dt>
							<dd>{SITE_LEGAL_STUBS.ipName}</dd>
						</div>
						<div>
							<dt>ИНН</dt>
							<dd>{SITE_LEGAL_STUBS.inn}</dd>
						</div>
						<div>
							<dt>ОГРНИП</dt>
							<dd>{SITE_LEGAL_STUBS.ogrnip}</dd>
						</div>
						<div>
							<dt>Юридический адрес</dt>
							<dd>{SITE_LEGAL_STUBS.legalAddress}</dd>
						</div>
					</dl>
					<p className='site-footer__legal-note'>
						Данные указаны для примера и будут заменены актуальными реквизитами перед публикацией.
					</p>
				</div>

				<div className='site-footer__bottom'>
					<p className='site-footer__copyright'>
						© {new Date().getFullYear()} Progyx. Все права защищены.
					</p>
				</div>
			</div>
		</footer>
	)
}
