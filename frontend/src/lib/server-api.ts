import { cookies } from 'next/headers'

import type { LessonPlayerPayload } from '@/components/lesson-player-helpers'
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

/**
 * Первичная загрузка урока: при 404 с бэкенда — сигнал для notFound() (без HTML в React).
 */
export async function fetchLessonPlayerInitial(lessonId: string): Promise<LessonPlayerPayload | 'not_found' | null> {
  const cookieStore = await cookies()
  const cookieHeader = FORWARDED_COOKIE_NAMES.map((name) => {
    const value = cookieStore.get(name)?.value
    return value ? `${name}=${encodeURIComponent(value)}` : ''
  })
    .filter(Boolean)
    .join('; ')

  const path = normalizePath(`/lessons/${encodeURIComponent(lessonId)}`)
  const response = await fetch(`${INTERNAL_API_URL}${path}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    cache: 'no-store',
  })
  const text = await response.text()
  if (response.status === 404) {
    return 'not_found'
  }
  if (!response.ok) {
    return null
  }
  try {
    return JSON.parse(text) as LessonPlayerPayload
  } catch {
    return null
  }
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

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    throw new Error(extractMessage(payload) || 'Server request failed')
  }
  return payload as T
}
