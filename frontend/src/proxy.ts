import { NextRequest, NextResponse } from 'next/server'

import { AUTH_ROUTE_PREFIXES, pathMatches } from '@/lib/auth-routes'
import { INTERNAL_API_URL } from '@/lib/server-env'

type UserRole = 'student' | 'teacher' | 'admin' | 'superadmin'

const ACCESS_COOKIE = 'codequest_access_token'
const REFRESH_COOKIE = 'codequest_refresh_token'
const ACCESS_EXPIRES_AT_COOKIE = 'codequest_access_expires_at'
const KNOWN_ROLES: UserRole[] = ['student', 'teacher', 'admin', 'superadmin']
const ROLE_RULES: Array<{ path: string; roles: UserRole[] }> = [
	{ path: '/dashboard', roles: KNOWN_ROLES },
	{ path: '/messages', roles: ['student', 'teacher'] },
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
	return parts.join('; ')
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

async function refreshSession(request: NextRequest) {
	const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value
	if (!refreshToken) return null

	try {
		const response = await fetch(`${INTERNAL_API_URL}/auth/refresh`, {
			method: 'POST',
			headers: {
				accept: 'application/json',
				cookie: authCookieHeader(request),
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
	const pathname = request.nextUrl.pathname
	const isAuthRoute = AUTH_ROUTE_PREFIXES.some((route) => pathMatches(pathname, route))
	const roleRule = ROLE_RULES.find((rule) => pathMatches(pathname, rule.path))

	if (!isAuthRoute && !roleRule) {
		return NextResponse.next()
	}

	const currentRole = accessRoleFromRequest(request)
	if (currentRole) {
		if (isAuthRoute) {
			return NextResponse.redirect(dashboardUrl(request))
		}
		if (roleRule && !roleRule.roles.includes(currentRole)) {
			return NextResponse.redirect(dashboardUrl(request))
		}
		return NextResponse.next()
	}

	const refreshedSession = await refreshSession(request)
	if (refreshedSession) {
		if (isAuthRoute) {
			return applyUpstreamAuthCookies(
				NextResponse.redirect(dashboardUrl(request)),
				refreshedSession.response,
			)
		}

		const response =
			roleRule && !roleRule.roles.includes(refreshedSession.role)
				? NextResponse.redirect(dashboardUrl(request))
				: NextResponse.next()
		return applyUpstreamAuthCookies(response, refreshedSession.response)
	}

	if (isAuthRoute) {
		return request.cookies.get(ACCESS_COOKIE) || request.cookies.get(REFRESH_COOKIE)
			? clearAuthCookies(NextResponse.next())
			: NextResponse.next()
	}

	return clearAuthCookies(NextResponse.redirect(loginUrl(request)))
}

export const config = {
	matcher: [
		'/dashboard/:path*',
		'/messages/:path*',
		'/roadmap/:path*',
		'/lessons/:path*',
		'/leaderboard/:path*',
		'/profile/:path*',
		'/teacher/:path*',
		'/admin/:path*',
		'/superadmin/:path*',
		'/auth/login/:path*',
		'/auth/register/:path*',
	],
}
