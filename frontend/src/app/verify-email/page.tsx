'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

import { ApiError, getApiErrorMessage, resendVerification, verifyEmail } from '@/lib/api'
import { setAuthenticatedSession } from '@/lib/session-store'
import { setTheme } from '@/lib/theme'
import type { UserRole } from '@/types'

type VerificationStatus =
	| 'idle'
	| 'verifying'
	| 'success'
	| 'invalid'
	| 'used'
	| 'expired'
	| 'error'

function statusFromCode(code: string | null): VerificationStatus {
	if (code === 'invalid_token') return 'invalid'
	if (code === 'used_token') return 'used'
	if (code === 'expired_token') return 'expired'
	return 'error'
}

function cabinetPathForRole(role: UserRole | undefined): string {
	if (role === 'parent') return '/parent/dashboard'
	if (role === 'teacher') return '/teacher'
	if (role === 'admin') return '/admin/users'
	if (role === 'superadmin') return '/superadmin/users'
	return '/dashboard'
}

function VerifyEmailContent() {
	const searchParams = useSearchParams()
	const token = (searchParams.get('token') || '').trim()
	const [status, setStatus] = useState<VerificationStatus>('verifying')
	const [message, setMessage] = useState<string>('Проверяем ссылку…')
	const [resending, setResending] = useState(false)
	const [resendNote, setResendNote] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false

		if (!token) {
			setStatus('invalid')
			setMessage('Ссылка для подтверждения недействительна.')
			return
		}

		setStatus('verifying')
		setMessage('Проверяем ссылку…')

		verifyEmail(token)
			.then((response) => {
				if (cancelled) return
				setStatus('success')
				if (response.authenticated && response.user) {
					setAuthenticatedSession(response.user)
					setTheme(response.user.theme)
					setMessage('Email подтверждён. Перенаправляем в кабинет…')
					window.location.replace(cabinetPathForRole(response.user.role))
					return
				}
				setMessage(
					response.already_verified
						? 'Email уже был подтверждён ранее. Можете войти в кабинет.'
						: response.message || 'Email подтверждён.',
				)
			})
			.catch((error: unknown) => {
				if (cancelled) return
				const code =
					error instanceof ApiError && error.payload && typeof error.payload === 'object'
						? ((error.payload as Record<string, unknown>).code as string | null) || null
						: null
				setStatus(statusFromCode(code))
				setMessage(getApiErrorMessage(error, 'Не удалось подтвердить email.'))
			})

		return () => {
			cancelled = true
		}
	}, [token])

	async function handleResend() {
		setResending(true)
		setResendNote(null)
		try {
			await resendVerification()
			setResendNote(
				'Если аккаунт с такой почтой существует и ещё не подтверждён, мы отправили письмо повторно.',
			)
		} catch (error) {
			setResendNote(
				getApiErrorMessage(
					error,
					'Не удалось отправить письмо повторно. Попробуйте позже.',
				),
			)
		} finally {
			setResending(false)
		}
	}

	const showResend = status === 'used' || status === 'expired' || status === 'invalid' || status === 'error'

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
							<p className='text-sm text-slate-500'>Подтверждение email</p>
						</div>
					</div>

					<h1 className='auth-form-title mt-6 text-3xl font-black leading-tight text-slate-900'>
						{status === 'success'
							? 'Email подтверждён'
							: status === 'verifying'
								? 'Подтверждаем email…'
								: status === 'expired'
									? 'Срок действия ссылки истёк'
									: status === 'used'
										? 'Ссылка уже использовалась'
										: 'Не удалось подтвердить email'}
					</h1>

					<p className='mt-4 text-sm leading-7 text-slate-600'>{message}</p>

					{resendNote ? (
						<div className='mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-700'>
							{resendNote}
						</div>
					) : null}

					<div className='mt-6 flex flex-wrap gap-2'>
						{status === 'success' ? (
							<Link href='/auth/login' className='brand-button-primary'>
								Войти в кабинет
							</Link>
						) : null}
						{showResend ? (
							<button
								type='button'
								className='brand-button-secondary'
								onClick={handleResend}
								disabled={resending}
							>
								{resending ? 'Отправляем…' : 'Отправить письмо повторно'}
							</button>
						) : null}
						<Link href='/auth/login' className='brand-button-ghost'>
							На страницу входа
						</Link>
					</div>
				</section>
			</div>
		</main>
	)
}

export default function VerifyEmailPage() {
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
			<VerifyEmailContent />
		</Suspense>
	)
}
