import { NextRequest, NextResponse } from 'next/server'

import { AUTH_ROUTE_PREFIXES, pathMatches } from '@/lib/auth-routes'
import { getInternalApiBaseUrl } from '@/lib/internal-api-base'

function buildContentSecurityPolicy() {
	const nonce = crypto.randomUUID().replace(/-/g, '')

	const scriptSrc =
		process.env.NODE_ENV !== 'production'
			? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
			: `'self' 'nonce-${nonce}' 'strict-dynamic'`

	const csp = [
		"default-src 'self'",
		`script-src ${scriptSrc}`,
		// No nonce on style-src: with a nonce present, browsers ignore 'unsafe-inline', which blocks
		// React style={{}} and other legitimate inline styles. Script nonce remains for script-src.
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https://downloader.disk.yandex.ru",
		"font-src 'self' data:",
		"connect-src 'self'",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		'upgrade-insecure-requests',
	].join('; ')

	return { nonce, csp }
}

function requestHeadersWithNonce(request: NextRequest, nonce: string) {
	const requestHeaders = new Headers(request.headers)
	requestHeaders.set('x-nonce', nonce)
	return requestHeaders
}

function withCsp(response: NextResponse, csp: string) {
	response.headers.set('Content-Security-Policy', csp)
	return response
}

type UserRole = 'student' | 'teacher' | 'parent' | 'admin' | 'superadmin'

const ACCESS_COOKIE = 'codequest_access_token'
const REFRESH_COOKIE = 'codequest_refresh_token'
const ACCESS_EXPIRES_AT_COOKIE = 'codequest_access_expires_at'
const CSRF_COOKIE = 'csrf_token'
const CSRF_HEADER = 'X-CSRF-Token'
const KNOWN_ROLES: UserRole[] = ['student', 'teacher', 'parent', 'admin', 'superadmin']
const ROLE_RULES: Array<{ path: string; roles: UserRole[] }> = [
	{ path: '/dashboard', roles: KNOWN_ROLES },
	{ path: '/messages', roles: ['student', 'teacher', 'parent'] },
	{ path: '/roadmap', roles: KNOWN_ROLES },
	{ path: '/lessons', roles: KNOWN_ROLES },
	{ path: '/leaderboard', roles: KNOWN_ROLES },
	{ path: '/profile', roles: KNOWN_ROLES },
	{ path: '/teacher', roles: ['teacher'] },
	{ path: '/admin', roles: ['admin', 'superadmin'] },
	{ path: '/superadmin', roles: ['superadmin'] },
]

function isKnownRole(value: string | undefined): value is UserRole {
	return !!value && KNOWN_ROLES.includes(value as UserRole)
}

function loginUrl(request: NextRequest) {
	return new URL('/auth/login', request.url)
}

function dashboardUrl(request: NextRequest) {
	return new URL('/dashboard', request.url)
}

function authCookieHeader(request: NextRequest) {
	const parts = [ACCESS_COOKIE, REFRESH_COOKIE]
		.map((name) => {
			const value = request.cookies.get(name)?.value
			return value ? `${name}=${encodeURIComponent(value)}` : ''
		})
		.filter(Boolean)
	const csrf = request.cookies.get(CSRF_COOKIE)?.value
	if (csrf) {
		parts.push(`${CSRF_COOKIE}=${encodeURIComponent(csrf)}`)
	}
	return parts.join('; ')
}

function requestOrigin(request: NextRequest) {
	return request.headers.get('origin')?.trim() || request.nextUrl.origin
}

function clearAuthCookies(response: NextResponse) {
	response.cookies.delete(ACCESS_COOKIE)
	response.cookies.delete(REFRESH_COOKIE)
	response.cookies.delete(ACCESS_EXPIRES_AT_COOKIE)
	return response
}

function decodeBase64Url(value: string) {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
	const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
	const binary = atob(padded)
	const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
	return new TextDecoder().decode(bytes)
}

function upstreamSetCookies(response: Response) {
	const headers = response.headers as Headers & {
		getSetCookie?: () => string[]
	}
	if (typeof headers.getSetCookie === 'function') {
		return headers.getSetCookie()
	}
	const fallback = response.headers.get('set-cookie')
	return fallback ? [fallback] : []
}

function applyUpstreamAuthCookies(target: NextResponse, upstream: Response) {
	for (const cookie of upstreamSetCookies(upstream)) {
		target.headers.append('set-cookie', cookie)
	}
	return target
}

function accessRoleFromRequest(request: NextRequest) {
	const accessToken = request.cookies.get(ACCESS_COOKIE)?.value?.trim()
	if (!accessToken) return null

	try {
		const [, payloadSegment] = accessToken.split('.')
		if (!payloadSegment) {
			return null
		}

		const payload = JSON.parse(decodeBase64Url(payloadSegment)) as {
			role?: string
			type?: string
			exp?: number
		}

		if (payload.type !== 'access' || !isKnownRole(payload.role) || typeof payload.exp !== 'number') {
			return null
		}

		return payload.exp > Math.floor(Date.now() / 1000) ? payload.role : null
	} catch {
		return null
	}
}

type LessonAccessPayload = {
	allowed?: boolean
	redirect_lesson_id?: number | null
}

async function forcedSequenceLessonGateResponse(
	request: NextRequest,
	role: UserRole | null,
	csp: string,
	refreshUpstream: Response | null,
): Promise<NextResponse | null> {
	if (role !== 'student' && role !== 'parent') {
		return null
	}
	const match = request.nextUrl.pathname.match(/^\/lessons\/(\d+)\/?$/)
	if (!match) {
		return null
	}
	const lessonId = match[1]
	try {
		const accessResponse = await fetch(
			`${getInternalApiBaseUrl()}/student/lesson-access/${encodeURIComponent(lessonId)}`,
			{
				method: 'GET',
				headers: {
					accept: 'application/json',
					cookie: authCookieHeader(request),
				},
				cache: 'no-store',
			},
		)
		if (!accessResponse.ok) {
			return null
		}
		const data = (await accessResponse.json()) as LessonAccessPayload
		if (data.allowed !== false) {
			return null
		}
		const targetId = data.redirect_lesson_id
		const dest =
			targetId != null && String(targetId) !== lessonId
				? new URL(`/lessons/${targetId}`, request.url)
				: new URL('/roadmap', request.url)
		let redirect = NextResponse.redirect(dest)
		if (refreshUpstream) {
			redirect = applyUpstreamAuthCookies(redirect, refreshUpstream)
		}
		return withCsp(redirect, csp)
	} catch {
		return null
	}
}

async function refreshSession(request: NextRequest) {
	const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value
	if (!refreshToken) return null

	try {
		const csrf = request.cookies.get(CSRF_COOKIE)?.value?.trim()
		const response = await fetch(`${getInternalApiBaseUrl()}/auth/refresh`, {
			method: 'POST',
			headers: {
				accept: 'application/json',
				cookie: authCookieHeader(request),
				origin: requestOrigin(request),
				...(csrf ? { [CSRF_HEADER]: csrf } : {}),
			},
			cache: 'no-store',
		})
		const data = (await response.json().catch(() => ({}))) as {
			user?: { role?: string }
		}
		if (!response.ok || !isKnownRole(data.user?.role)) {
			return null
		}
		return {
			role: data.user.role,
			response,
		}
	} catch {
		return null
	}
}

export async function proxy(request: NextRequest) {
	const { nonce, csp } = buildContentSecurityPolicy()
	const requestHeaders = requestHeadersWithNonce(request, nonce)

	const pathname = request.nextUrl.pathname
	const isAuthRoute = AUTH_ROUTE_PREFIXES.some((route) => pathMatches(pathname, route))
	const roleRule = ROLE_RULES.find((rule) => pathMatches(pathname, rule.path))

	const nextWithCsp = () => withCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp)
	const redirectWithCsp = (url: URL) => withCsp(NextResponse.redirect(url), csp)

	if (!isAuthRoute && !roleRule) {
		return nextWithCsp()
	}

	const currentRole = accessRoleFromRequest(request)
	if (currentRole) {
		if (isAuthRoute) {
			return redirectWithCsp(dashboardUrl(request))
		}
		if (roleRule && !roleRule.roles.includes(currentRole)) {
			return redirectWithCsp(dashboardUrl(request))
		}
		const lessonGate = await forcedSequenceLessonGateResponse(request, currentRole, csp, null)
		if (lessonGate) {
			return lessonGate
		}
		return nextWithCsp()
	}

	const refreshedSession = await refreshSession(request)
	if (refreshedSession) {
		if (isAuthRoute) {
			return withCsp(
				applyUpstreamAuthCookies(NextResponse.redirect(dashboardUrl(request)), refreshedSession.response),
				csp,
			)
		}

		if (roleRule && !roleRule.roles.includes(refreshedSession.role)) {
			return withCsp(
				applyUpstreamAuthCookies(NextResponse.redirect(dashboardUrl(request)), refreshedSession.response),
				csp,
			)
		}
		const refreshedLessonGate = await forcedSequenceLessonGateResponse(
			request,
			refreshedSession.role,
			csp,
			refreshedSession.response,
		)
		if (refreshedLessonGate) {
			return refreshedLessonGate
		}
		const response = NextResponse.next({ request: { headers: requestHeaders } })
		return withCsp(applyUpstreamAuthCookies(response, refreshedSession.response), csp)
	}

	if (isAuthRoute) {
		if (request.cookies.get(ACCESS_COOKIE) || request.cookies.get(REFRESH_COOKIE)) {
			return withCsp(clearAuthCookies(NextResponse.next({ request: { headers: requestHeaders } })), csp)
		}
		return nextWithCsp()
	}

	return withCsp(
		clearAuthCookies(NextResponse.redirect(loginUrl(request))),
		csp,
	)
}

export const config = {
	matcher: [
		{
			// All app routes: CSP + nonce; auth paths also run access checks above.
			source: '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
			missing: [
				{ type: 'header', key: 'next-router-prefetch' },
				{ type: 'header', key: 'purpose', value: 'prefetch' },
			],
		},
	],
}
