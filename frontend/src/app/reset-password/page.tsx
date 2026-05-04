'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useMemo, useState } from 'react'

import { ApiError, getApiErrorMessage, resetPassword } from '@/lib/api'

const PASSWORD_MIN_LENGTH = 10

function passwordPolicyError(value: string): string | null {
	if (!value) return 'Введите новый пароль.'
	if (value.length < PASSWORD_MIN_LENGTH) {
		return `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов.`
	}
	if (/\s/.test(value)) return 'Пароль не должен содержать пробелы.'
	return null
}

function ResetPasswordContent() {
	const router = useRouter()
	const searchParams = useSearchParams()
	const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams])

	const [password, setPassword] = useState('')
	const [confirm, setConfirm] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [success, setSuccess] = useState<string | null>(null)
	const [tokenError, setTokenError] = useState<string | null>(null)

	async function handleSubmit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		setSuccess(null)
		setTokenError(null)

		if (!token) {
			setTokenError(
				'Ссылка для сброса пароля недействительна или устарела. Запросите новую.',
			)
			return
		}

		const policyError = passwordPolicyError(password)
		if (policyError) {
			setError(policyError)
			return
		}
		if (password !== confirm) {
			setError('Пароли не совпадают.')
			return
		}

		setSubmitting(true)
		try {
			const response = await resetPassword(token, password)
			setSuccess(
				response.message
					|| 'Пароль обновлён. Сейчас вы будете перенаправлены ко входу.',
			)
			setPassword('')
			setConfirm('')
			window.setTimeout(() => router.replace('/auth/login'), 1800)
		} catch (apiError) {
			const code =
				apiError instanceof ApiError && apiError.payload && typeof apiError.payload === 'object'
					? ((apiError.payload as Record<string, unknown>).code as string | undefined)
					: undefined
			if (code === 'invalid_token' || code === 'used_token' || code === 'expired_token') {
				setTokenError(
					getApiErrorMessage(
						apiError,
						'Ссылка для сброса пароля недействительна или устарела.',
					),
				)
			} else {
				setError(
					getApiErrorMessage(apiError, 'Не удалось обновить пароль. Попробуйте ещё раз.'),
				)
			}
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
							<p className='text-sm text-slate-500'>Сброс пароля</p>
						</div>
					</div>

					<h1 className='auth-form-title mt-6 text-3xl font-black leading-tight text-slate-900'>
						Задайте новый пароль
					</h1>
					<p className='mt-3 text-sm leading-7 text-slate-600'>
						Минимум {PASSWORD_MIN_LENGTH} символов, без пробелов. Используйте
						уникальную комбинацию строчных и заглавных букв, цифры и спецсимвола —
						как при регистрации.
					</p>

					{tokenError ? (
						<div className='mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-700'>
							{tokenError}
							<div className='mt-3'>
								<Link
									href='/forgot-password'
									className='brand-button-primary'
								>
									Запросить новое письмо
								</Link>
							</div>
						</div>
					) : null}

					{success ? (
						<div className='mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-800'>
							{success}
						</div>
					) : null}

					{error ? (
						<div className='mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-700'>
							{error}
						</div>
					) : null}

					{!tokenError ? (
						<form className='mt-6 space-y-4' noValidate onSubmit={handleSubmit}>
							<label className='block space-y-2'>
								<span className='auth-label text-sm font-semibold text-slate-700'>
									Новый пароль
								</span>
								<div className='auth-password-shell flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3'>
									<input
										className='auth-password-input w-full bg-transparent'
										type={showPassword ? 'text' : 'password'}
										autoComplete='new-password'
										value={password}
										onChange={(event) => setPassword(event.target.value)}
										disabled={submitting || Boolean(success)}
									/>
									<button
										type='button'
										className='auth-password-toggle shrink-0 text-sm font-semibold text-sky-700'
										onClick={() => setShowPassword((value) => !value)}
									>
										{showPassword ? 'Скрыть' : 'Показать'}
									</button>
								</div>
							</label>

							<label className='block space-y-2'>
								<span className='auth-label text-sm font-semibold text-slate-700'>
									Повторите пароль
								</span>
								<input
									className='auth-control w-full rounded-2xl border border-slate-200 px-4 py-3'
									type={showPassword ? 'text' : 'password'}
									autoComplete='new-password'
									value={confirm}
									onChange={(event) => setConfirm(event.target.value)}
									disabled={submitting || Boolean(success)}
								/>
							</label>

							<button
								type='submit'
								className='auth-submit-button brand-button-primary w-full'
								disabled={submitting || Boolean(success)}
							>
								{submitting ? 'Сохраняем…' : 'Сохранить новый пароль'}
							</button>
						</form>
					) : null}

					<div className='mt-6 flex flex-wrap gap-3 text-sm'>
						<Link
							href='/auth/login'
							className='font-semibold text-sky-700 hover:underline'
						>
							Вернуться ко входу
						</Link>
					</div>
				</section>
			</div>
		</main>
	)
}

export default function ResetPasswordPage() {
	return (
		<Suspense
			fallback={
				<main className='brand-auth-shell'>
					<div className='auth-layout brand-page-shell flex min-h-screen items-center justify-center py-10'>
						<p className='text-sm text-slate-500'>Загружаем…</p>
					</div>
				</main>
			}
		>
			<ResetPasswordContent />
		</Suspense>
	)
}
