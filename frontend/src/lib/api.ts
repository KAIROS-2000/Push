import { PUBLIC_API_URL } from './public-env'
import { setAnonymousSession } from './session-store'

const API_URL = PUBLIC_API_URL
let refreshRequest: Promise<boolean> | null = null

export type AuthMode = 'required' | 'optional' | 'none'
type ApiAuthOption = AuthMode | boolean | { auth?: AuthMode }

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

function resolveAuthMode(option: ApiAuthOption | undefined): AuthMode {
  if (typeof option === 'boolean') {
    return option ? 'required' : 'none'
  }
  if (typeof option === 'string') {
    return option
  }
  return option?.auth ?? 'none'
}

function buildHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers || {})
  const body = init?.body
  if (body && !(body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

const SESSION_TERMINATION_CODES = new Set(['invalid_token', 'session_revoked', 'csrf_invalid'])
const CSRF_INVALID_CODE = 'csrf_invalid'

function getAuthErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const code = (payload as Record<string, unknown>).code
  return typeof code === 'string' ? code : null
}

function shouldClearSessionAfterAuthFailure(
  authMode: AuthMode,
  status: number,
  payload: unknown,
): boolean {
  const code = getAuthErrorCode(payload)
  if (code && SESSION_TERMINATION_CODES.has(code)) {
    return true
  }
  return authMode !== 'none' && status === 401
}

function payloadLooksLikeHtml(value: string): boolean {
  const t = value.trimStart()
  return t.startsWith('<!') || t.toLowerCase().startsWith('<html')
}

function httpStatusFallbackMessage(status: number): string | null {
  if (status === 404) return 'Страница или ресурс не найдены.'
  if (status === 403) return 'Недостаточно прав для доступа.'
  if (status === 401) return 'Требуется вход в аккаунт.'
  if (status >= 500) return 'Сервер временно недоступен. Попробуйте позже.'
  return null
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) {
    if (payloadLooksLikeHtml(payload)) return null
    return payload.trim()
  }
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const record = payload as Record<string, unknown>

  const message = record.message
  if (typeof message === 'string' && message.trim()) {
    return message.trim()
  }
  if (Array.isArray(message)) {
    const parts = message
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    if (parts.length) return parts.join(' ')
  }

  const error = record.error
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  const errors = record.errors
  if (errors && typeof errors === 'object' && !Array.isArray(errors)) {
    const parts: string[] = []
    for (const value of Object.values(errors as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) parts.push(value.trim())
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.trim()) parts.push(item.trim())
        }
      }
    }
    if (parts.length) return parts.join(' ')
  }

  return null
}

export function getApiErrorMessage(error: unknown, fallback = 'Произошла ошибка.'): string {
  if (error instanceof ApiError) {
    const direct = error.message?.trim()
    if (direct) return direct
    const parsed = extractErrorMessage(error.payload)
    if (parsed) return parsed
    return fallback
  }
  if (error instanceof Error) {
    const m = error.message?.trim()
    return m || fallback
  }
  return fallback
}

async function parsePayload(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => '')
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

async function refreshSession() {
  if (refreshRequest) return refreshRequest

  refreshRequest = fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshRequest = null
    })

  return refreshRequest
}

type ClearSessionOptions = {
  redirectToLogin?: boolean
}

function redirectToLogin() {
  if (typeof window === 'undefined') return
  if (window.location.pathname.startsWith('/auth/login')) return
  window.location.replace('/auth/login')
}

/** Clears local session snapshot and asks the backend to drop HttpOnly auth cookies. */
export async function clearSessionSilently(options: ClearSessionOptions = {}) {
  setAnonymousSession()

  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch {
    // Ignore logout cleanup failures when the session is already invalid.
  }

  if (options.redirectToLogin) {
    redirectToLogin()
  }
}

export async function api<T>(path: string, init: RequestInit = {}, auth: ApiAuthOption = 'none'): Promise<T> {
  const authMode = resolveAuthMode(auth)
  const send = async () => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: buildHeaders(init),
      cache: init.cache ?? 'no-store',
      credentials: 'same-origin',
    })
    const payload = await parsePayload(response)
    return { response, payload }
  }

  let { response, payload } = await send()

  if (authMode !== 'none' && response.status === 401) {
    const refreshed = await refreshSession()
    if (refreshed) {
      ;({ response, payload } = await send())
    }
  }

  if (!response.ok) {
    const errorCode = getAuthErrorCode(payload)
    if (shouldClearSessionAfterAuthFailure(authMode, response.status, payload)) {
      await clearSessionSilently({ redirectToLogin: errorCode === CSRF_INVALID_CODE })
    }
    throw new ApiError(
      extractErrorMessage(payload) ||
        httpStatusFallbackMessage(response.status) ||
        'Ошибка запроса',
      response.status,
      payload,
    )
  }

  if (path === '/auth/logout') {
    setAnonymousSession()
  }

  return payload as T
}
