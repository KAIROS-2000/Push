import type { UserRole } from '@/types'

const ACCESS = 'codequest_access_token'
const REFRESH = 'codequest_refresh_token'
const ACCESS_TTL_SECONDS = 30 * 60
const REFRESH_TTL_SECONDS = 14 * 24 * 60 * 60
const KNOWN_ROLES = new Set<UserRole>(['student', 'teacher', 'admin', 'superadmin'])

function parseBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const paddingLength = (4 - (normalized.length % 4)) % 4
  const padded = `${normalized}${'='.repeat(paddingLength)}`
  try {
    return atob(padded)
  } catch {
    return ''
  }
}

function readTokenPayload(token: string) {
  const [, payloadPart] = token.split('.')
  if (!payloadPart) return null
  try {
    return JSON.parse(parseBase64Url(payloadPart)) as { exp?: number; role?: string }
  } catch {
    return null
  }
}

function readTokenExpiry(token: string) {
  const payload = readTokenPayload(token)
  return typeof payload?.exp === 'number' ? payload.exp : null
}

function tokenTtl(token: string, fallbackSeconds: number) {
  const exp = readTokenExpiry(token)
  if (exp === null) return fallbackSeconds
  return Math.max(exp - Math.floor(Date.now() / 1000), 0)
}

function readCookie(name: string) {
  if (typeof document === 'undefined') return ''
  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : ''
}

function writeCookie(name: string, value: string, maxAge: number) {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
}

function removeCookie(name: string) {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
}

export function getAccessToken() {
  if (typeof window === 'undefined') return ''
  return readCookie(ACCESS)
}

export function getAccessTokenRole(): UserRole | null {
  const payload = readTokenPayload(getAccessToken())
  return payload?.role && KNOWN_ROLES.has(payload.role as UserRole) ? (payload.role as UserRole) : null
}

export function getRefreshToken() {
  if (typeof window === 'undefined') return ''
  return readCookie(REFRESH)
}

export function saveTokens(accessToken: string, refreshToken: string) {
  if (typeof window === 'undefined') return
  writeCookie(ACCESS, accessToken, tokenTtl(accessToken, ACCESS_TTL_SECONDS))
  writeCookie(REFRESH, refreshToken, tokenTtl(refreshToken, REFRESH_TTL_SECONDS))
}

export function clearTokens() {
  if (typeof window === 'undefined') return
  removeCookie(ACCESS)
  removeCookie(REFRESH)
}
