'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import {
	ArrowRight,
	BadgeCheck,
	Banknote,
	Brain,
	Briefcase,
	Building2,
	ChevronRight,
	Clock3,
	Cloud,
	Code2,
	Database,
	LockKeyhole,
	MapPin,
	MonitorSmartphone,
	ShieldCheck,
	Sparkles,
	TrendingUp,
	Wallet,
	type LucideIcon,
} from 'lucide-react'

import { useUserPageMotion } from '@/hooks/use-user-page-motion'
import { useSessionUser } from '@/lib/auth-session'

type TrackKey = 'all' | 'code' | 'ai' | 'data' | 'infra' | 'security'

type Vacancy = {
	id: string
	title: string
	company: string
	location: string
	salary: string
	track: Exclude<TrackKey, 'all'>
	level: string
	growth: string
	summary: string
	stack: string[]
	icon: LucideIcon
}

const trackFilters: Array<{ key: TrackKey; label: string; icon: LucideIcon }> = [
	{ key: 'all', label: 'Все роли', icon: Briefcase },
	{ key: 'code', label: 'Разработка', icon: Code2 },
	{ key: 'ai', label: 'AI', icon: Brain },
	{ key: 'data', label: 'Данные', icon: Database },
	{ key: 'infra', label: 'Инфра', icon: Cloud },
	{ key: 'security', label: 'Безопасность', icon: LockKeyhole },
]

const marketStats = [
	{
		label: 'Средняя по IT',
		value: '≈203 000 ₽',
		detail: 'ориентир Habr Career по рынку',
		icon: Wallet,
		tone: 'blue',
	},
	{
		label: 'Junior',
		value: '80-120 тыс.',
		detail: 'старт при сильном портфолио',
		icon: Sparkles,
		tone: 'green',
	},
	{
		label: 'Middle',
		value: '170-250 тыс.',
		detail: 'самая массовая точка роста',
		icon: TrendingUp,
		tone: 'yellow',
	},
	{
		label: 'Senior / Lead',
		value: '300-450 тыс.+',
		detail: 'за архитектуру и ответственность',
		icon: BadgeCheck,
		tone: 'violet',
	},
]

const vacancies: Vacancy[] = [
	{
		id: 'backend-platform',
		title: 'Backend-разработчик',
		company: 'FinCore Labs',
		location: 'Москва / удаленно',
		salary: '180-320 тыс. ₽',
		track: 'code',
		level: 'Middle+',
		growth: '+ к архитектуре и тимлиду',
		summary:
			'Проектирует API, платежные контуры, очереди и интеграции. Сильная база алгоритмов и системного мышления быстро конвертируется в деньги.',
		stack: ['Python', 'Go', 'PostgreSQL', 'Redis', 'API'],
		icon: Code2,
	},
	{
		id: 'ai-engineer',
		title: 'AI / ML инженер',
		company: 'PromptOps Studio',
		location: 'Санкт-Петербург / гибрид',
		salary: '220-450 тыс. ₽',
		track: 'ai',
		level: 'Middle-Senior',
		growth: '+ к LLM-продуктам',
		summary:
			'Собирает модели, пайплайны данных и AI-функции в продуктах. Рынок быстро растет, но требует математики, Python и инженерной дисциплины.',
		stack: ['Python', 'LLM', 'PyTorch', 'RAG', 'MLOps'],
		icon: Brain,
	},
	{
		id: 'devops-sre',
		title: 'DevOps / SRE инженер',
		company: 'CloudBridge',
		location: 'Удаленно',
		salary: '210-420 тыс. ₽',
		track: 'infra',
		level: 'Middle-Senior',
		growth: '+ к platform engineering',
		summary:
			'Держит сервисы стабильными: CI/CD, облака, мониторинг, безопасность релизов. Хорошие SRE редко остаются без сильных офферов.',
		stack: ['Linux', 'Docker', 'Kubernetes', 'CI/CD', 'Grafana'],
		icon: Cloud,
	},
	{
		id: 'data-engineer',
		title: 'Data Engineer',
		company: 'Retail Data Hub',
		location: 'Казань / удаленно',
		salary: '190-380 тыс. ₽',
		track: 'data',
		level: 'Middle',
		growth: '+ к data platform lead',
		summary:
			'Строит хранилища, витрины и обработку данных для аналитики и AI. Чем больше компаний внедряют AI, тем ценнее надежные данные.',
		stack: ['SQL', 'Python', 'Airflow', 'Kafka', 'DWH'],
		icon: Database,
	},
	{
		id: 'security-analyst',
		title: 'Инженер кибербезопасности',
		company: 'SecureLayer',
		location: 'Екатеринбург / гибрид',
		salary: '160-350 тыс. ₽',
		track: 'security',
		level: 'Junior-Middle',
		growth: '+ к security architect',
		summary:
			'Ищет уязвимости, настраивает защиту и помогает командам выпускать продукт без критичных рисков. Спрос растет вместе с цифровизацией.',
		stack: ['Networks', 'Linux', 'SIEM', 'AppSec', 'Python'],
		icon: LockKeyhole,
	},
	{
		id: 'frontend-product',
		title: 'Frontend / Product Engineer',
		company: 'EduFlow',
		location: 'Удаленно',
		salary: '150-300 тыс. ₽',
		track: 'code',
		level: 'Junior-Middle',
		growth: '+ к full-stack продукту',
		summary:
			'Делает быстрые интерфейсы, дизайн-системы и AI-помощников внутри продукта. В 2026 ценится не верстка, а мышление продуктового инженера.',
		stack: ['React', 'Next.js', 'TypeScript', 'UX', 'AI tools'],
		icon: MonitorSmartphone,
	},
	{
		id: 'systems-analyst',
		title: 'Системный аналитик',
		company: 'BankTech',
		location: 'Москва / гибрид',
		salary: '150-280 тыс. ₽',
		track: 'data',
		level: 'Middle',
		growth: '+ к product ownership',
		summary:
			'Переводит задачи бизнеса в понятные требования для разработки. Хороший аналитик ускоряет команду и снижает стоимость ошибок.',
		stack: ['BPMN', 'SQL', 'API', 'User stories', 'Docs'],
		icon: Building2,
	},
	{
		id: 'qa-automation',
		title: 'QA Automation',
		company: 'Quality Grid',
		location: 'Новосибирск / удаленно',
		salary: '120-240 тыс. ₽',
		track: 'infra',
		level: 'Junior-Middle',
		growth: '+ к test architecture',
		summary:
			'Автоматизирует проверки и защищает релизы от регрессий. Хороший старт в инженерную культуру: код, продукт и качество в одном маршруте.',
		stack: ['TypeScript', 'Playwright', 'API tests', 'CI', 'SQL'],
		icon: ShieldCheck,
	},
]

const prospects = [
	{
		title: 'AI не забирает профессию, а поднимает планку',
		text: 'Рутинный код дешевеет. Дороже становятся архитектура, проверка гипотез, работа с данными и умение превращать AI в продукт.',
		icon: Brain,
	},
	{
		title: 'Junior-рынок жестче, чем раньше',
		text: 'Работодатели чаще ждут портфолио, GitHub, проектный опыт и базовую инженерную дисциплину. Учиться нужно сразу через практику.',
		icon: Code2,
	},
	{
		title: 'Сильнее всего растут узкие специализации',
		text: 'DevOps, ML, Data Engineering, Security и системная аналитика получают премию за ответственность и редкую экспертизу.',
		icon: TrendingUp,
	},
]

const roadmap = [
	{
		stage: '1',
		title: 'База',
		period: '0-3 месяца',
		text: 'Алгоритмы, Python или JavaScript, Git, простые проекты и привычка доводить задачу до результата.',
	},
	{
		stage: '2',
		title: 'Портфолио',
		period: '4-8 месяцев',
		text: '3-5 законченных работ: сайт, бот, API, мини-игра, аналитический проект или AI-инструмент.',
	},
	{
		stage: '3',
		title: 'Профиль',
		period: '9-14 месяцев',
		text: 'Выбор направления: разработка, данные, AI, безопасность или инфраструктура. Глубина важнее хаотичного набора курсов.',
	},
	{
		stage: '4',
		title: 'Первый оффер',
		period: '15+ месяцев',
		text: 'Стажировка, junior-позиция, олимпиадный профиль, фриланс или проектная роль в команде.',
	},
]

export function ItCareerPage() {
	const rootRef = useRef<HTMLElement | null>(null)
	const [activeTrack, setActiveTrack] = useState<TrackKey>('all')
	const [selectedVacancyId, setSelectedVacancyId] = useState(vacancies[0].id)
	const { status: sessionStatus } = useSessionUser({ auth: 'optional' })

	const filteredVacancies = useMemo(() => {
		if (activeTrack === 'all') return vacancies
		return vacancies.filter(vacancy => vacancy.track === activeTrack)
	}, [activeTrack])

	const selectedVacancy = useMemo<Vacancy>(() => {
		return (
			filteredVacancies.find(vacancy => vacancy.id === selectedVacancyId) ??
			filteredVacancies[0] ??
			vacancies[0]
		)
	}, [filteredVacancies, selectedVacancyId])

	useUserPageMotion(rootRef, [activeTrack, selectedVacancy.id, sessionStatus])

	function handleTrackChange(track: TrackKey) {
		setActiveTrack(track)
		const firstVacancy =
			track === 'all'
				? vacancies[0]
				: vacancies.find(vacancy => vacancy.track === track)
		if (firstVacancy) setSelectedVacancyId(firstVacancy.id)
	}

	const SelectedIcon = selectedVacancy.icon

	return (
		<main ref={rootRef} className='brand-public-shell it-career-page'>
			<section className='it-career-hero'>
				<div className='brand-page-shell it-career-hero__grid'>
					<div className='it-career-hero__copy' data-motion-hero-copy>
						<p className='it-career-eyebrow'>Перспективы работы в IT</p>
						<h1 className='it-career-hero__title'>
							IT в 2026: профессии, зарплаты и понятный путь к первому офферу.
						</h1>
						<p className='it-career-hero__lead'>
							Рынок стал взрослее: простых входов меньше, зато сильный ученик с
							портфолио, базой и понятным направлением получает больше
							вариантов, чем в классических профессиях.
						</p>

						<div className='it-career-hero__actions'>
							<Link href='/auth/register' className='brand-button-primary it-career-cta'>
								Начать маршрут
								<ArrowRight aria-hidden='true' size={18} />
							</Link>
							<Link href='/roadmap' className='brand-button-secondary it-career-cta'>
								Посмотреть уроки
							</Link>
						</div>

						<div className='it-career-hero__chips' aria-label='Ключевые сигналы рынка'>
							<span>AI-навыки</span>
							<span>Портфолио</span>
							<span>Удаленка</span>
							<span>Инженерная база</span>
						</div>
					</div>

					<div className='it-career-market' data-motion-hero-visual data-motion-parallax>
						<div className='it-career-market__head'>
							<div>
								<p>Рынок 2026</p>
								<strong>Зарплатный ориентир</strong>
							</div>
							<span>live</span>
						</div>

						<div className='it-career-market__salary'>
							<span>Средняя зарплата IT</span>
							<strong>≈203 000 ₽/мес.</strong>
							<p>Ориентир по открытым зарплатным данным и анкетам рынка.</p>
						</div>

						<div className='it-career-market__bars' aria-label='Сравнение зарплат по уровню'>
							<div>
								<span>Junior</span>
								<i style={{ width: '34%' }} />
							</div>
							<div>
								<span>Middle</span>
								<i style={{ width: '68%' }} />
							</div>
							<div>
								<span>Senior</span>
								<i style={{ width: '92%' }} />
							</div>
						</div>

						<div className='it-career-market__ticker'>
							<span>AI Engineer</span>
							<span>Data Engineer</span>
							<span>DevOps / SRE</span>
							<span>Security</span>
						</div>
					</div>
				</div>
			</section>

			<section className='brand-page-shell it-career-stats' data-motion-stagger>
				{marketStats.map(stat => {
					const Icon = stat.icon
					return (
						<article
							key={stat.label}
							className={`it-career-stat it-career-stat--${stat.tone}`}
							data-motion-item
							data-motion-hover
						>
							<span className='it-career-stat__icon'>
								<Icon aria-hidden='true' size={22} />
							</span>
							<p>{stat.label}</p>
							<strong>{stat.value}</strong>
							<span>{stat.detail}</span>
						</article>
					)
				})}
			</section>

			<section className='brand-page-shell it-career-vacancies' data-motion-reveal>
				<div className='it-career-section-head'>
					<p className='it-career-eyebrow'>Лента вакансий</p>
					<h2>Куда может прийти ученик, если строить навыки как систему.</h2>
					<p>
						Это не объявления конкретных компаний, а реалистичные рыночные
						профили: роли, вилки, стек и рост, который стоит показывать ребенку
						заранее.
					</p>
				</div>

				<div className='it-career-filter' role='tablist' aria-label='Фильтр направлений'>
					{trackFilters.map(filter => {
						const Icon = filter.icon
						const isActive = activeTrack === filter.key
						return (
							<button
								key={filter.key}
								type='button'
								role='tab'
								aria-selected={isActive}
								className={`it-career-filter__button ${isActive ? 'it-career-filter__button--active' : ''}`}
								onClick={() => handleTrackChange(filter.key)}
							>
								<Icon aria-hidden='true' size={17} />
								{filter.label}
							</button>
						)
					})}
				</div>

				<div className='it-career-vacancies__layout'>
					<div className='it-career-feed' aria-label='Прокручиваемая лента вакансий'>
						{filteredVacancies.map(vacancy => {
							const Icon = vacancy.icon
							const isSelected = selectedVacancy.id === vacancy.id
							return (
								<button
									key={vacancy.id}
									type='button'
									className={`it-career-vacancy-card ${isSelected ? 'it-career-vacancy-card--active' : ''}`}
									onClick={() => setSelectedVacancyId(vacancy.id)}
									aria-pressed={isSelected}
								>
									<span className='it-career-vacancy-card__icon'>
										<Icon aria-hidden='true' size={22} />
									</span>
									<span className='it-career-vacancy-card__meta'>
										<span>{vacancy.level}</span>
										<span>{vacancy.salary}</span>
									</span>
									<strong>{vacancy.title}</strong>
									<span className='it-career-vacancy-card__company'>
										{vacancy.company}
									</span>
									<span className='it-career-vacancy-card__growth'>
										{vacancy.growth}
									</span>
								</button>
							)
						})}
					</div>

					<article className='it-career-vacancy-detail'>
						<div className='it-career-vacancy-detail__top'>
							<span className='it-career-vacancy-detail__icon'>
								<SelectedIcon aria-hidden='true' size={28} />
							</span>
							<div>
								<p>{selectedVacancy.company}</p>
								<h3>{selectedVacancy.title}</h3>
							</div>
						</div>
						<p className='it-career-vacancy-detail__summary'>
							{selectedVacancy.summary}
						</p>
						<div className='it-career-vacancy-detail__facts'>
							<span>
								<Banknote aria-hidden='true' size={17} />
								{selectedVacancy.salary}
							</span>
							<span>
								<MapPin aria-hidden='true' size={17} />
								{selectedVacancy.location}
							</span>
							<span>
								<Clock3 aria-hidden='true' size={17} />
								{selectedVacancy.growth}
							</span>
						</div>
						<div className='it-career-vacancy-detail__stack'>
							{selectedVacancy.stack.map(skill => (
								<span key={skill}>{skill}</span>
							))}
						</div>
					</article>
				</div>
			</section>

			<section className='brand-page-shell it-career-prospects' data-motion-stagger>
				<div className='it-career-section-head it-career-section-head--compact'>
					<p className='it-career-eyebrow'>Перспективы профессии</p>
					<h2>Что будет цениться сильнее всего.</h2>
				</div>
				<div className='it-career-prospects__grid'>
					{prospects.map(item => {
						const Icon = item.icon
						return (
							<article className='it-career-prospect' key={item.title} data-motion-item>
								<Icon aria-hidden='true' size={24} />
								<h3>{item.title}</h3>
								<p>{item.text}</p>
							</article>
						)
					})}
				</div>
			</section>

			<section className='brand-page-shell it-career-road' data-motion-reveal>
				<div className='it-career-road__panel'>
					<div className='it-career-section-head it-career-section-head--compact'>
						<p className='it-career-eyebrow'>Маршрут до рынка</p>
						<h2>Работа в IT начинается не с резюме, а с траектории.</h2>
					</div>

					<div className='it-career-road__steps'>
						{roadmap.map(step => (
							<article className='it-career-road-step' key={step.stage}>
								<span>{step.stage}</span>
								<div>
									<p>{step.period}</p>
									<h3>{step.title}</h3>
									<strong>{step.text}</strong>
								</div>
								<ChevronRight aria-hidden='true' size={20} />
							</article>
						))}
					</div>
				</div>
			</section>

			<section className='brand-page-shell it-career-final' data-motion-reveal>
				<div>
					<p className='it-career-eyebrow'>Progyx</p>
					<h2>Покажите ребенку не просто уроки, а будущую профессию.</h2>
					<p>
						Когда ученик видит связь между задачами, проектами и реальными
						вакансиями, обучение перестает быть абстрактным и превращается в
						маршрут к самостоятельности.
					</p>
				</div>
				<div className='it-career-final__actions'>
					<Link href='/auth/register' className='brand-button-primary it-career-cta'>
						Создать аккаунт
						<ArrowRight aria-hidden='true' size={18} />
					</Link>
					<Link href='/parent' className='brand-button-ghost it-career-cta'>
						Для родителей
					</Link>
				</div>
			</section>

		</main>
	)
}
