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

function extractErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('message' in payload)) {
    return null
  }
  const message = payload.message
  return typeof message === 'string' && message.trim() ? message : null
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

async function clearSessionSilently() {
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
    if (authMode !== 'none' && response.status === 401) {
      await clearSessionSilently()
    }
    throw new ApiError(extractErrorMessage(payload) || 'Ошибка запроса', response.status, payload)
  }

  if (path === '/auth/logout') {
    setAnonymousSession()
  }

  return payload as T
}
