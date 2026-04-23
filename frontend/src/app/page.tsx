'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRef } from 'react'

import { SiteFooter } from '@/components/site-footer'
import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { useSessionUser } from '@/lib/auth-session'

const scenes = [
	{
		src: '/progyx-scene-roadmap.svg',
		alt: 'Сцена маршрута обучения с модулями и прогрессом',
		eyebrow: 'Маршрут',
		title: 'Карта шагов вместо хаотичного списка уроков.',
		text: 'Ученик сразу видит, что открыто сейчас и куда двигаться дальше.',
	},
	{
		src: '/progyx-scene-lesson.svg',
		alt: 'Сцена урока с теорией, кодом и чат-помощником',
		eyebrow: 'Урок',
		title: 'Теория, практика и код собраны в одном экране.',
		text: 'Никакой перегрузки: один фокус, один следующий шаг, один понятный результат.',
	},
]

export default function HomePage() {
	const rootRef = useRef<HTMLElement | null>(null)
	const { status: sessionStatus } = useSessionUser({ auth: 'optional' })
	const showGuestActions = sessionStatus === 'anonymous'

	useUserPageMotion(rootRef, [sessionStatus])

	return (
		<main ref={rootRef} className='brand-public-shell'>
			<section className='home-poster'>
				<div className='home-poster__shell'>
					<div className='home-poster__copy' data-motion-hero-copy>
						<p className='brand-eyebrow'>Progyx</p>
						<h1 className='brand-display home-poster__title'>
							Учёба, которая сразу выглядит как свой цифровой проект.
						</h1>
						<p className='brand-lead home-poster__lead'>
							Ребёнок открывает маршрут, урок и приступает к обучению. Родитель
							видит движение по шагам.
						</p>

						{showGuestActions && (
							<div className='home-poster__actions'>
								<Link
									href='/auth/register'
									className='brand-button-primary home-cta-button home-cta-button--primary'
								>
									Создать аккаунт
								</Link>
								<Link
									href='/parent'
									className='brand-button-secondary home-cta-button home-cta-button--secondary'
								>
									Для родителей
								</Link>
								<Link
									href='/auth/login'
									className='brand-button-ghost home-cta-button home-cta-button--ghost'
								>
									Войти
								</Link>
							</div>
						)}
					</div>

					<div
						className='home-poster__visual'
						data-motion-hero-visual
						data-motion-parallax
					>
						<div className='home-poster__frame' data-motion-hover>
							<Image
								src='/progyx-scene-dashboard.svg'
								alt='Сцена кабинета ученика с прогрессом, заданиями и следующими уроками'
								width={1480}
								height={1100}
								priority
								className='home-poster__image'
							/>
						</div>
					</div>
				</div>
			</section>

			<section className='brand-page-shell home-scenes' data-motion-reveal>
				<div className='home-scenes__intro'>
					<p className='brand-eyebrow'>Внутри платформы</p>
					<h2 className='home-scenes__title'>
						Три поверхности, которые держат весь путь ученика.
					</h2>
				</div>

				<div className='home-scenes__grid' data-motion-stagger>
					{scenes.map(scene => (
						<article
							key={scene.src}
							className='home-scene'
							data-motion-item
							data-motion-hover
						>
							<div className='home-scene__image-wrap'>
								<Image
									src={scene.src}
									alt={scene.alt}
									width={1280}
									height={960}
									className='home-scene__image'
								/>
							</div>
							<div className='home-scene__body'>
								<p className='brand-eyebrow'>{scene.eyebrow}</p>
								<h3 className='home-scene__title'>{scene.title}</h3>
								<p className='home-scene__text'>{scene.text}</p>
							</div>
						</article>
					))}
				</div>
			</section>

			{sessionStatus === 'anonymous' && (
				<section className='brand-page-shell home-final-cta' data-motion-reveal>
					<div className='home-final-cta__panel'>
						<div>
							<p className='brand-eyebrow'>Старт</p>
							<h2 className='home-final-cta__title'>
								Открыть ребёнку спокойный и сильный вход в технологии.
							</h2>
							<p className='home-final-cta__text'>
								Один брендовый контур: маршрут, уроки, код, прогресс и семейный
								доступ.
							</p>
						</div>

						<div className='home-final-cta__actions'>
							<Link
								href='/auth/register'
								className='brand-button-primary home-cta-button home-cta-button--primary'
							>
								Создать аккаунт
							</Link>
							<Link
								href='/parent'
								className='brand-button-secondary home-cta-button home-cta-button--secondary'
							>
								Открыть родительский доступ
							</Link>
						</div>
					</div>
				</section>
			)}

			<SiteFooter showRegisterLink={showGuestActions} />
		</main>
	)
}
