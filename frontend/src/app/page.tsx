import { SiteHeader } from '@/components/site-header'
import Link from 'next/link'

export default function HomePage() {
	return (
		<main>
			<SiteHeader />
			<section className='mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center'>
				<div>
					<div className='inline-flex rounded-full bg-white px-4 py-2 text-xs font-semibold shadow-sm sm:text-sm'>
						Кодиумс для детей и подростков
					</div>
					<h2 className='mt-6 max-w-4xl text-4xl font-black leading-tight text-slate-900 sm:text-5xl lg:text-6xl'>
						Программирование, которое увлекает с первого занятия.
					</h2>
					<p className='mt-6 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8'>
						В Кодиумс ребёнок не просто смотрит уроки, а шаг за шагом создаёт,
						думает, решает и начинает чувствовать себя уверенно в цифровом мире.
						Обучение выстроено так, чтобы интерес не пропадал, а результат был
						виден уже с первых тем.
					</p>
					<div className='mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4'>
						<Link
							href='/auth/register'
							className='inline-flex w-full justify-center rounded-full bg-slate-900 px-6 py-3 font-semibold text-white shadow-xl shadow-slate-300 sm:w-auto'
						>
							Попробовать обучение
						</Link>
						<Link
							href='/roadmap'
							className='inline-flex w-full justify-center rounded-full bg-white px-6 py-3 font-semibold text-slate-900 shadow-md sm:w-auto'
						>
							Посмотреть программу
						</Link>
						<Link
							href='/parent'
							className='inline-flex w-full justify-center rounded-full bg-violet-100 px-6 py-3 font-semibold text-violet-800 shadow-md sm:w-auto'
						>
							Информация для родителей
						</Link>
					</div>
					<div className='mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
						{[
							[
								'Уроки, которые держат внимание',
								'Короткие объяснения, живые примеры и задания, после которых хочется идти дальше, а не откладывать обучение.',
							],
							[
								'Путь от интереса к навыку',
								'От первых шагов до уверенных проектов: ребёнок постепенно осваивает логику, алгоритмы и современное мышление.',
							],
							[
								'Обучение с пользой на будущее',
								'Занятия развивают не только техническое мышление, но и самостоятельность, внимательность и привычку искать решения.',
							],
						].map(([title, text]) => (
							<article
								key={title}
								className='rounded-[26px] bg-white/90 p-5 shadow-lg'
							>
								<h3 className='text-lg font-black text-slate-900'>{title}</h3>
								<p className='mt-2 text-sm leading-7 text-slate-600'>{text}</p>
							</article>
						))}
					</div>
				</div>

				<div className='codequest-card grid-bg overflow-hidden p-6 sm:p-8'>
					<p className='text-sm font-bold uppercase tracking-[0.24em] text-sky-600'>
						Почему выбирают Кодиумс
					</p>
					<div className='mt-5 grid gap-4'>
						{[
							[
								'Ясный старт',
								'Начать можно без перегруза: материал подаётся дружелюбно и помогает быстро включиться в обучение.',
							],
							[
								'Мотивация без скуки',
								'Занятия чередуют объяснение и действие, поэтому ребёнок не теряет вовлечённость и лучше запоминает новое.',
							],
							[
								'Практика с первого шага',
								'Каждая тема закрепляется в деле: знания не остаются теорией, а превращаются в реальные умения.',
							],
							[
								'Уверенность в результате',
								'Ребёнок видит собственный рост через выполненные задания, новые темы и ощущение "у меня получается".',
							],
						].map(([title, text]) => (
							<div
								key={title}
								className='rounded-[24px] border border-white/60 bg-white/80 p-5'
							>
								<h3 className='text-xl font-black text-slate-900'>{title}</h3>
								<p className='mt-2 text-sm leading-7 text-slate-600'>{text}</p>
							</div>
						))}
					</div>
					<div className='mt-6 rounded-[24px] bg-slate-900 p-5 text-white'>
						<p className='text-sm uppercase tracking-[0.2em] text-sky-300'>
							Первый шаг к сильному навыку
						</p>
						<p className='mt-3 text-sm text-slate-200'>
							Если вы ищете обучение, которое не отпугивает сложностью и при этом
							даёт реальную пользу, Кодиумс помогает начать спокойно и двигаться
							вперёд с интересом.
						</p>
					</div>
				</div>
			</section>
		</main>
	)
}
