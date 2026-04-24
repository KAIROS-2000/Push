import { cookies } from 'next/headers'

import { INTERNAL_API_URL } from '@/lib/server-env'

const FORWARDED_COOKIE_NAMES = [
  'codequest_access_token',
  'codequest_refresh_token',
  'csrf_token',
] as const
const CSRF_HEADER = 'X-CSRF-Token'

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

function extractMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) {
    return null
  }
  return typeof payload.message === 'string' ? payload.message : null
}

export async function serverApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookieStore = await cookies()
  const cookieHeader = FORWARDED_COOKIE_NAMES.map((name) => {
    const value = cookieStore.get(name)?.value
    return value ? `${name}=${encodeURIComponent(value)}` : ''
  })
    .filter(Boolean)
    .join('; ')

  const method = (init.method || 'GET').toUpperCase()
  const csrf = cookieStore.get('csrf_token')?.value?.trim()
  const needsCsrfHeader = !['GET', 'HEAD', 'OPTIONS'].includes(method)

  const response = await fetch(`${INTERNAL_API_URL}${normalizePath(path)}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers || {}),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(needsCsrfHeader && csrf ? { [CSRF_HEADER]: csrf } : {}),
    },
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => null)) as T | { message?: string } | null
  if (!response.ok) {
    throw new Error(extractMessage(payload) || 'Server request failed')
  }
  return payload as T
}
