'use client'

import Image from 'next/image'
import Link from 'next/link'
import { FormEvent, useState } from 'react'

import { forgotPassword, getApiErrorMessage } from '@/lib/api'

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

const NEUTRAL_NOTICE =
	'Если аккаунт с такой почтой существует, мы отправили письмо для сброса пароля. Проверьте папку «Спам» — иногда оно попадает туда.'

export default function ForgotPasswordPage() {
	const [email, setEmail] = useState('')
	const [submitting, setSubmitting] = useState(false)
	// `notice` is intentionally always the same neutral message regardless of
	// whether the email exists — the backend mirrors this contract.
	const [notice, setNotice] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function handleSubmit(event: FormEvent) {
		event.preventDefault()
		const normalized = email.trim().toLowerCase()
		setError(null)
		if (!normalized || !EMAIL_RE.test(normalized)) {
			setError('Укажите корректный email.')
			return
		}
		setSubmitting(true)
		try {
			await forgotPassword(normalized)
			setNotice(NEUTRAL_NOTICE)
		} catch (apiError) {
			// 429 from the backend lands here. We still surface a neutral message
			// — actual rate-limit details (if any) come through as `error`.
			setError(
				getApiErrorMessage(apiError, 'Не удалось отправить запрос. Попробуйте позже.'),
			)
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<main className='brand-auth-shell'>
			<div className='auth-layout brand-page-shell flex min-h-screen items-center justify-center py-10'>
				<section className='auth-form-panel codequest-card max-w-xl p-8'>
					<div className='flex items-center gap-3'>
						<Image
							src='/progyx-logo.png'
							alt='Логотип Progyx'
							width={48}
							height={48}
							className='h-12 w-12 object-contain'
							priority
						/>
						<div>
							<p className='brand-eyebrow'>Progyx</p>
							<p className='text-sm text-slate-500'>Восстановление пароля</p>
						</div>
					</div>

					<h1 className='auth-form-title mt-6 text-3xl font-black leading-tight text-slate-900'>
						Забыли пароль?
					</h1>
					<p className='mt-3 text-sm leading-7 text-slate-600'>
						Введите email, который вы указывали при регистрации. Мы отправим
						письмо со ссылкой для сброса пароля. Ссылка будет действовать 30 минут.
					</p>

					{notice ? (
						<div className='mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800'>
							{notice}
						</div>
					) : null}

					{error ? (
						<div className='mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-700'>
							{error}
						</div>
					) : null}

					<form className='mt-6 space-y-4' noValidate onSubmit={handleSubmit}>
						<label className='block space-y-2'>
							<span className='auth-label text-sm font-semibold text-slate-700'>
								Email
							</span>
							<input
								type='email'
								autoComplete='email'
								className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								placeholder='name@example.com'
								disabled={submitting}
							/>
						</label>

						<button
							type='submit'
							className='auth-submit-button brand-button-primary w-full'
							disabled={submitting}
						>
							{submitting ? 'Отправляем…' : 'Отправить письмо'}
						</button>
					</form>

					<div className='mt-6 flex flex-wrap gap-3 text-sm'>
						<Link
							href='/auth/login'
							className='font-semibold text-sky-700 hover:underline'
						>
							Вернуться ко входу
						</Link>
						<span className='text-slate-300'>•</span>
						<Link
							href='/auth/register'
							className='font-semibold text-sky-700 hover:underline'
						>
							Создать аккаунт
						</Link>
					</div>
				</section>
			</div>
		</main>
	)
}
