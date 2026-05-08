'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { UserItem } from '@/types'
import {
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	Headphones,
	Loader2,
	Send,
	ShieldCheck,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

const STEPS = ['Тема', 'Детали', 'Проверка'] as const
const SUPPORT_SUBJECT_MAX = 80

const CATEGORIES: Array<{
	id: string
	title: string
	hint: string
}> = [
	{
		id: 'technical',
		title: 'Техника и доступ',
		hint: 'Сайт, вход, ошибки, скорость',
	},
	{
		id: 'account',
		title: 'Аккаунт и профиль',
		hint: 'Email, пароль, данные ребёнка',
	},
	{
		id: 'billing',
		title: 'Оплата и документы',
		hint: 'Чеки, возвраты, реквизиты',
	},
	{
		id: 'content',
		title: 'Уроки и материалы',
		hint: 'Задания, прогресс, доступ к модулю',
	},
	{
		id: 'other',
		title: 'Другое',
		hint: 'Если сложно выбрать категорию',
	},
]

function ProgressSteps({ step }: { step: number }) {
	return (
		<ol className='flex flex-wrap gap-2' aria-label='Шаги анкеты'>
			{STEPS.map((label, i) => {
				const done = i < step
				const active = i === step
				return (
					<li
						key={label}
						className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ring-1 ring-inset ${
							active
								? 'bg-slate-900 text-white ring-slate-900'
								: done
									? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
									: 'bg-slate-50 text-slate-500 ring-slate-200'
						}`}
					>
						<span className='tabular-nums'>{i + 1}</span>
						{label}
					</li>
				)
			})}
		</ol>
	)
}

export function SupportRequestPage({ initialUser }: { initialUser: UserItem | null }) {
	const router = useRouter()
	const [step, setStep] = useState(0)
	const [category, setCategory] = useState<string | null>(null)
	const [subject, setSubject] = useState('')
	const [description, setDescription] = useState('')
	const [submitting, setSubmitting] = useState(false)

	const eligible =
		initialUser &&
		(initialUser.role === 'student' ||
			initialUser.role === 'teacher' ||
			initialUser.role === 'parent')

	const categoryLabel = useMemo(
		() => CATEGORIES.find(c => c.id === category)?.title ?? '',
		[category],
	)

	const canNextFromTopic = Boolean(
		category &&
			subject.trim().length >= 4 &&
			subject.trim().length <= SUPPORT_SUBJECT_MAX,
	)
	const canNextFromDetails = description.trim().length >= 20

	const goNext = useCallback(() => {
		setStep(s => Math.min(s + 1, STEPS.length - 1))
	}, [])

	const goBack = useCallback(() => {
		setStep(s => Math.max(s - 1, 0))
	}, [])

	const submit = useCallback(async () => {
		if (!eligible || !category) return
		setSubmitting(true)
		try {
			const res = await api<{ ticket: { ticket_id: number } }>(
				'/support/tickets',
				{
					method: 'POST',
					body: JSON.stringify({
						category,
						subject: subject.trim(),
						description: description.trim(),
					}),
				},
				'required',
			)
			const id = res.ticket?.ticket_id
			if (id) {
				showSuccessToast('Обращение создано. Открываем переписку…')
				router.push(`/messages?ticket=${id}`)
			}
		} catch (e) {
			showErrorToast(getApiErrorMessage(e, 'Не удалось отправить обращение.'))
		} finally {
			setSubmitting(false)
		}
	}, [eligible, category, subject, description, router])

	if (!initialUser) {
		return (
			<section className='mx-auto w-full max-w-2xl space-y-8 px-4 py-16 sm:py-24'>
				<div className='space-y-4 text-center'>
					<p className='brand-eyebrow justify-center'>Поддержка Progyx</p>
					<h1 className='text-3xl font-black text-slate-900 sm:text-4xl'>
						Расскажите нам — мы ответим в общем чате
					</h1>
					<p className='text-base leading-relaxed text-slate-600'>
						Чтобы создать обращение и переписываться со службой поддержки, войдите в аккаунт ученика,
						учителя или родителя. После отправки анкеты диалог появится в разделе «Сообщения».
					</p>
				</div>
				<div className='flex flex-wrap justify-center gap-3'>
					<Link href='/auth/login' className='brand-button-primary inline-flex h-11 items-center px-5'>
						Войти
					</Link>
					<Link
						href='/auth/register'
						className='inline-flex h-11 items-center rounded-full border border-slate-300 px-5 font-bold text-slate-800 hover:border-slate-400'
					>
						Регистрация
					</Link>
				</div>
			</section>
		)
	}

	if (!eligible) {
		return (
			<section className='mx-auto w-full max-w-xl space-y-6 px-4 py-16'>
				<h1 className='text-2xl font-black text-slate-900'>Поддержка через анкету</h1>
				<p className='text-slate-600'>
					Форма доступна ученикам, учителям и родителям. Для вопросов администрирования используйте
					привычные каналы.
				</p>
				<Link href='/dashboard' className='font-semibold text-slate-900 underline'>
					На главную панель
				</Link>
			</section>
		)
	}

	return (
		<section className='mx-auto w-full max-w-3xl px-4 py-10 sm:py-14'>
			<div className='mb-8 flex flex-wrap items-start justify-between gap-4'>
				<div className='space-y-3'>
					<p className='brand-eyebrow'>Поддержка</p>
					<h1 className='text-3xl font-black text-slate-900 sm:text-[2rem]'>
						Новое обращение
					</h1>
					<p className='max-w-prose text-sm leading-relaxed text-slate-600'>
						Три коротких шага — затем тикет попадёт к администраторам, а вы сможете продолжить диалог в
						разделе{' '}
						<Link href='/messages' className='font-semibold text-slate-900 underline'>
							Сообщения
						</Link>
						.
					</p>
				</div>
				<div className='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'>
					<ProgressSteps step={step} />
				</div>
			</div>

			<div className='codequest-card overflow-hidden'>
				<div className='border-b border-slate-100 bg-slate-50/80 px-5 py-4 sm:px-8'>
					<div className='flex flex-wrap items-center gap-3 text-sm text-slate-600'>
						<ShieldCheck className='text-emerald-600' size={18} aria-hidden />
						<span>
							Мы видим ваш аккаунт и историю обращения только для решения запроса. Не передавайте пароли
							и платёжные коды в переписке.
						</span>
					</div>
				</div>

				<div className='space-y-8 px-5 py-8 sm:px-8'>
					{step === 0 ? (
						<div className='space-y-6'>
							<div>
								<h2 className='text-lg font-black text-slate-900'>Что случилось?</h2>
								<p className='mt-1 text-sm text-slate-500'>
									Выберите тему — так запрос быстрее попадёт к нужному специалисту.
								</p>
							</div>
							<div className='grid gap-3 sm:grid-cols-2'>
								{CATEGORIES.map(cat => {
									const active = category === cat.id
									return (
										<button
											key={cat.id}
											type='button'
											onClick={() => setCategory(cat.id)}
											className={`flex flex-col rounded-2xl border px-4 py-4 text-left transition ${
												active
													? 'border-slate-900 bg-white shadow-md ring-2 ring-slate-900/10'
													: 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-white'
											}`}
										>
											<span className='font-black text-slate-900'>{cat.title}</span>
											<span className='mt-1 text-xs font-medium text-slate-500'>{cat.hint}</span>
										</button>
									)
								})}
							</div>
							<label className='block space-y-2'>
								<span className='text-sm font-bold text-slate-800'>Краткая тема</span>
								<input
									type='text'
									maxLength={SUPPORT_SUBJECT_MAX}
									className='h-12 w-full rounded-2xl border border-slate-200 px-4 text-base font-semibold text-slate-900 outline-none ring-slate-900/5 focus:border-slate-900 focus:ring-4'
									placeholder='Например: не сохраняется урок по Python'
									value={subject}
									onChange={e => setSubject(e.target.value)}
								/>
								<div className='flex flex-wrap justify-between gap-2 text-xs text-slate-500'>
									<span>От 4 до {SUPPORT_SUBJECT_MAX} символов</span>
									<span className='tabular-nums'>
										{subject.length}/{SUPPORT_SUBJECT_MAX}
									</span>
								</div>
							</label>
						</div>
					) : null}

					{step === 1 ? (
						<div className='space-y-4'>
							<div>
								<h2 className='text-lg font-black text-slate-900'>Подробности</h2>
								<p className='mt-1 text-sm text-slate-500'>
									Чем конкретнее описание, тем быстрее разберёмся. Можно списком шагов «как
									воспроизвести».
								</p>
							</div>
							<label className='block space-y-2'>
								<span className='text-sm font-bold text-slate-800'>Описание</span>
								<textarea
									rows={10}
									maxLength={4000}
									className='w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base leading-relaxed text-slate-900 outline-none ring-slate-900/5 focus:border-slate-900 focus:ring-4'
									placeholder={
										'— Что вы делали?\n— Что ожидали?\n— Что произошло вместо этого?\n— Браузер / устройство (если уместно)'
									}
									value={description}
									onChange={e => setDescription(e.target.value)}
								/>
								<div className='flex flex-wrap justify-between gap-2 text-xs text-slate-500'>
									<span>Рекомендуем не меньше 20 символов</span>
									<span className='tabular-nums'>{description.length} / 4000</span>
								</div>
							</label>
						</div>
					) : null}

					{step === 2 ? (
						<div className='space-y-5'>
							<h2 className='text-lg font-black text-slate-900'>Проверьте перед отправкой</h2>
							<dl className='grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 text-sm'>
								<div>
									<dt className='text-xs font-black uppercase tracking-wide text-slate-500'>
										Категория
									</dt>
									<dd className='mt-1 font-semibold text-slate-900'>{categoryLabel}</dd>
								</div>
								<div>
									<dt className='text-xs font-black uppercase tracking-wide text-slate-500'>Тема</dt>
									<dd className='mt-1 font-semibold text-slate-900'>{subject.trim()}</dd>
								</div>
								<div>
									<dt className='text-xs font-black uppercase tracking-wide text-slate-500'>
										Описание
									</dt>
									<dd className='mt-1 whitespace-pre-wrap break-words leading-relaxed text-slate-800'>
										{description.trim()}
									</dd>
								</div>
							</dl>
							<div className='flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-950'>
								<CheckCircle2 className='mt-0.5 shrink-0' size={20} aria-hidden />
								<p>
									После отправки откроется чат с поддержкой: сверху будет текст анкеты, ниже —
									переписка. Новые ответы также видны в списке обращений в «Сообщениях».
								</p>
							</div>
						</div>
					) : null}

					<div className='flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6'>
						<button
							type='button'
							onClick={goBack}
							disabled={step === 0 || submitting}
							className='inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-40'
						>
							<ArrowLeft size={16} />
							Назад
						</button>
						<div className='flex flex-wrap gap-2'>
							{step < STEPS.length - 1 ? (
								<button
									type='button'
									onClick={goNext}
									disabled={
										submitting ||
										(step === 0 && !canNextFromTopic) ||
										(step === 1 && !canNextFromDetails)
									}
									className='brand-button-primary inline-flex items-center gap-2 px-5 py-2 text-sm'
								>
									Далее
									<ArrowRight size={16} />
								</button>
							) : (
								<button
									type='button'
									onClick={() => void submit()}
									disabled={submitting || !canNextFromTopic || !canNextFromDetails}
									className='brand-button-primary inline-flex items-center gap-2 px-5 py-2 text-sm'
								>
									{submitting ? (
										<Loader2 className='animate-spin' size={16} />
									) : (
										<Send size={16} />
									)}
									Отправить обращение
								</button>
							)}
						</div>
					</div>
				</div>
			</div>

			<div className='mt-8 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-500'>
				<Headphones size={16} aria-hidden />
				<span>Срочный вопрос? Проверьте также контакты в подвале сайта.</span>
			</div>
		</section>
	)
}
