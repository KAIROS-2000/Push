import { NextRequest, NextResponse } from 'next/server'

type UserRole = 'student' | 'teacher' | 'admin' | 'superadmin'

interface JwtHeader {
  alg?: string
}

interface JwtPayload {
  role?: string
  type?: string
  exp?: number
}

const ACCESS_COOKIE = 'codequest_access_token'
const REFRESH_COOKIE = 'codequest_refresh_token'
const ACCESS_TTL_FALLBACK_SECONDS = 30 * 60
const REFRESH_TTL_FALLBACK_SECONDS = 14 * 24 * 60 * 60
const API_URLS = Array.from(
  new Set(
    [
      process.env.INTERNAL_API_URL,
      process.env.NEXT_PUBLIC_API_URL,
      'http://backend:8000/api',
      'http://localhost:8000/api',
    ].filter((value): value is string => Boolean(value)),
  ),
)
const KNOWN_ROLES: UserRole[] = ['student', 'teacher', 'admin', 'superadmin']
const AUTH_ROUTES = ['/auth/login', '/auth/register']
const ROLE_RULES: Array<{ path: string; roles: UserRole[] }> = [
  { path: '/dashboard', roles: KNOWN_ROLES },
  { path: '/roadmap', roles: KNOWN_ROLES },
  { path: '/lessons', roles: KNOWN_ROLES },
  { path: '/leaderboard', roles: KNOWN_ROLES },
  { path: '/profile', roles: KNOWN_ROLES },
  { path: '/teacher', roles: ['teacher'] },
  { path: '/admin', roles: ['admin', 'superadmin'] },
  { path: '/superadmin', roles: ['superadmin'] },
]

function pathMatches(pathname: string, target: string) {
  return pathname === target || pathname.startsWith(`${target}/`)
}

function parseBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const paddingLength = (4 - (normalized.length % 4)) % 4
  const padded = `${normalized}${'='.repeat(paddingLength)}`
  try {
    return atob(padded)
  } catch {
    return null
  }
}

function parseBase64UrlBytes(value: string): Uint8Array | null {
  const decoded = parseBase64Url(value)
  if (!decoded) return null
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

function parseTokenPart<T>(value: string): T | null {
  const decoded = parseBase64Url(value)
  if (!decoded) return null
  try {
    return JSON.parse(decoded) as T
  } catch {
    return null
  }
}

function isKnownRole(value: string | undefined): value is UserRole {
  return !!value && KNOWN_ROLES.includes(value as UserRole)
}

async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
  const secret = process.env.SECRET_KEY
  if (!secret) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerPart, payloadPart, signaturePart] = parts
  if (!headerPart || !payloadPart || !signaturePart) return null

  const header = parseTokenPart<JwtHeader>(headerPart)
  if (!header || header.alg !== 'HS256') return null

  const payload = parseTokenPart<JwtPayload>(payloadPart)
  if (!payload || payload.type !== 'access' || !isKnownRole(payload.role) || typeof payload.exp !== 'number') {
    return null
  }
  if (payload.exp * 1000 <= Date.now()) return null

  const signatureBytes = parseBase64UrlBytes(signaturePart)
  if (!signatureBytes) return null

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const isValid = await crypto.subtle.verify(
    'HMAC',
    key,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(new TextEncoder().encode(`${headerPart}.${payloadPart}`)),
  )
  if (!isValid) return null

  return payload
}

function loginUrl(request: NextRequest) {
  return new URL('/auth/login', request.url)
}

function dashboardUrl(request: NextRequest) {
  return new URL('/dashboard', request.url)
}

function tokenMaxAge(token: string, fallbackSeconds: number) {
  const payload = parseTokenPart<JwtPayload>(token.split('.')[1] || '')
  if (typeof payload?.exp !== 'number') return fallbackSeconds
  return Math.max(payload.exp - Math.floor(Date.now() / 1000), 0)
}

function applyAuthCookies(response: NextResponse, request: NextRequest, accessToken: string, refreshToken: string) {
  const secure = request.nextUrl.protocol === 'https:'
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: accessToken,
    path: '/',
    sameSite: 'lax',
    secure,
    maxAge: tokenMaxAge(accessToken, ACCESS_TTL_FALLBACK_SECONDS),
  })
  response.cookies.set({
    name: REFRESH_COOKIE,
    value: refreshToken,
    path: '/',
    sameSite: 'lax',
    secure,
    maxAge: tokenMaxAge(refreshToken, REFRESH_TTL_FALLBACK_SECONDS),
  })
  return response
}

function clearAuthCookies(response: NextResponse) {
  response.cookies.delete(ACCESS_COOKIE)
  response.cookies.delete(REFRESH_COOKIE)
  return response
}

async function refreshSession(refreshToken: string) {
  for (const apiUrl of API_URLS) {
    try {
      const response = await fetch(`${apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        return null
      }
      if (
        typeof data.access_token !== 'string' ||
        typeof data.refresh_token !== 'string'
      ) {
        return null
      }

      const payload = await verifyAccessToken(data.access_token)
      if (!payload || !isKnownRole(payload.role)) {
        return null
      }

      return {
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string,
        role: payload.role,
      }
    } catch {
      continue
    }
  }
  return null
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isAuthRoute = AUTH_ROUTES.some((route) => pathMatches(pathname, route))
  const roleRule = ROLE_RULES.find((rule) => pathMatches(pathname, rule.path))

  if (!isAuthRoute && !roleRule) {
    return NextResponse.next()
  }

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value || ''
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value || ''

  const payload = accessToken ? await verifyAccessToken(accessToken) : null
  if (payload && isKnownRole(payload.role)) {
    if (isAuthRoute) {
      return NextResponse.redirect(dashboardUrl(request))
    }

    if (roleRule && !roleRule.roles.includes(payload.role)) {
      return NextResponse.redirect(dashboardUrl(request))
    }

    return NextResponse.next()
  }

  const refreshedSession = refreshToken ? await refreshSession(refreshToken) : null
  if (refreshedSession) {
    if (isAuthRoute) {
      return applyAuthCookies(
        NextResponse.redirect(dashboardUrl(request)),
        request,
        refreshedSession.accessToken,
        refreshedSession.refreshToken,
      )
    }

    const response =
      roleRule && !roleRule.roles.includes(refreshedSession.role)
        ? NextResponse.redirect(dashboardUrl(request))
        : NextResponse.next()
    return applyAuthCookies(response, request, refreshedSession.accessToken, refreshedSession.refreshToken)
  }

  if (isAuthRoute) {
    return accessToken || refreshToken ? clearAuthCookies(NextResponse.next()) : NextResponse.next()
  }

  return clearAuthCookies(NextResponse.redirect(loginUrl(request)))
}

export const config = {
  matcher: [
    '/dashboard/:path*',
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
