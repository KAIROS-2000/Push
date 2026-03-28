import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from '@/lib/storage'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api'
let refreshRequest: Promise<string | null> | null = null

function buildHeaders(initHeaders?: HeadersInit, accessToken?: string) {
  const headers = new Headers(initHeaders || {})
  headers.set('Content-Type', 'application/json')
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  } else {
    headers.delete('Authorization')
  }
  return headers
}

async function refreshAccessToken() {
  if (refreshRequest) return refreshRequest

  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  refreshRequest = fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: 'no-store',
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}))
      if (
        !response.ok ||
        typeof data.access_token !== 'string' ||
        typeof data.refresh_token !== 'string'
      ) {
        clearTokens()
        return null
      }

      saveTokens(data.access_token, data.refresh_token)
      return data.access_token as string
    })
    .catch(() => {
      clearTokens()
      return null
    })
    .finally(() => {
      refreshRequest = null
    })

  return refreshRequest
}

export async function api<T>(path: string, init?: RequestInit, withAuth = false): Promise<T> {
  const send = (accessToken?: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: buildHeaders(init?.headers, withAuth ? accessToken : undefined),
      cache: 'no-store',
    })

  let response = await send(withAuth ? getAccessToken() : undefined)
  let data = await response.json().catch(() => ({}))

  if (withAuth && response.status === 401) {
    const refreshedAccessToken = await refreshAccessToken()
    if (refreshedAccessToken) {
      response = await send(refreshedAccessToken)
      data = await response.json().catch(() => ({}))
    }
  }

  if (!response.ok) {
    if (withAuth && response.status === 401) {
      clearTokens()
    }
    throw new Error(data.message || 'Ошибка запроса')
  }
  return data as T
}
